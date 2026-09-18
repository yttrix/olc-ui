package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/yttrix/olc-ui/internal/store"
)

const (
	cookieName    = "olcui_session"
	sessionTTL    = 30 * 24 * time.Hour
	loginWindow   = 10 * time.Minute
	loginAttempts = 8

	keyAdminUser = "admin_user"
	keyAdminHash = "admin_hash"
)

// SetAdmin stores admin credentials and drops every existing session.
func SetAdmin(st *store.Store, user, pass string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if err != nil {
		return err //nolint:wrapcheck // bcrypt errors are self-describing
	}
	if err := st.SetSetting(keyAdminUser, user); err != nil {
		return err
	}
	st.DeleteSession("", true)
	return st.SetSetting(keyAdminHash, string(hash))
}

// HasAdmin reports whether credentials were set up.
func HasAdmin(st *store.Store) bool { return st.Setting(keyAdminHash) != "" }

func checkPassword(st *store.Store, user, pass string) bool {
	okUser := subtle.ConstantTimeCompare([]byte(user), []byte(st.Setting(keyAdminUser))) == 1
	okPass := bcrypt.CompareHashAndPassword([]byte(st.Setting(keyAdminHash)), []byte(pass)) == nil
	return okUser && okPass
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func (s *Server) authed(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	return err == nil && c.Value != "" && s.store.SessionValid(hashToken(c.Value))
}

// requireAuth guards API handlers. Mutating requests must also carry the
// X-OLC header, which a cross-site form cannot set (CSRF defence on top of
// SameSite=Strict cookies).
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authed(r) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("X-OLC") != "1" {
			writeErr(w, http.StatusForbidden, "missing X-OLC header")
			return
		}
		next(w, r)
	}
}

type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func (l *limiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	kept := l.hits[ip][:0]
	for _, t := range l.hits[ip] {
		if now.Sub(t) < loginWindow {
			kept = append(kept, t)
		}
	}
	l.hits[ip] = kept
	return len(kept) < loginAttempts
}

func (l *limiter) fail(ip string) {
	l.mu.Lock()
	l.hits[ip] = append(l.hits[ip], time.Now())
	l.mu.Unlock()
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	// Trust X-Forwarded-For only from a local reverse proxy.
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	return host
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.limit.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, try later")
		return
	}
	var req struct{ User, Pass string }
	if !readJSON(w, r, &req) {
		return
	}
	if !checkPassword(s.store, req.User, req.Pass) {
		s.limit.fail(ip)
		s.store.Audit("login_failed", ip)
		writeErr(w, http.StatusUnauthorized, "wrong login or password")
		return
	}
	tok := store.RandomToken(32)
	if err := s.store.CreateSession(hashToken(tok), sessionTTL); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: tok, Path: s.base, MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil,
	})
	s.store.Audit("login", ip)
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.store.DeleteSession(hashToken(c.Value), false)
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: s.base, MaxAge: -1, HttpOnly: true})
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	ok := s.authed(r)
	resp := map[string]any{"authenticated": ok}
	if ok {
		resp["user"] = s.store.Setting(keyAdminUser)
	}
	writeJSON(w, resp)
}

func (s *Server) handlePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Old  string `json:"old"`
		User string `json:"user"`
		New  string `json:"new"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !checkPassword(s.store, s.store.Setting(keyAdminUser), req.Old) {
		writeErr(w, http.StatusBadRequest, "current password is wrong")
		return
	}
	user := strings.TrimSpace(req.User)
	if user == "" {
		user = s.store.Setting(keyAdminUser)
	}
	if len(req.New) < 8 {
		writeErr(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if err := SetAdmin(s.store, user, req.New); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.Audit("password_changed", user)
	writeJSON(w, map[string]any{"ok": true})
}
