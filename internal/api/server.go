// Package api is the HTTP layer of the panel: the admin SPA, its JSON API
// under <base>api/, and public subscriptions under /sub/<token>.
package api

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/yttrix/olc-ui/internal/store"
	"github.com/yttrix/olc-ui/internal/supervisor"
)

// Setting keys owned by the API.
const (
	KeyPanelName  = "panel_name"
	KeyPublicHost = "public_host"
	KeyRefresh    = "sub_refresh"
	KeyJitsi      = "jitsi_instance"
)

// Server serves the panel.
type Server struct {
	certStatus func() any
	tmpDir     string
	store      *store.Store
	sup        *supervisor.Supervisor
	base       string // e.g. "/a1b2c3d4/"
	web        fs.FS
	version    string
	started    time.Time
	limit      *limiter
}

// Options carries optional collaborators.
type Options struct {
	DataDir    string
	CertStatus func() any
}

// New builds the HTTP handler. base must start and end with "/".
func New(st *store.Store, sup *supervisor.Supervisor, base string, web fs.FS, version string, opts Options) http.Handler {
	s := &Server{
		store: st, sup: sup, base: base, web: web, version: version,
		started: time.Now(), limit: &limiter{hits: map[string][]time.Time{}},
		certStatus: opts.CertStatus, tmpDir: tempDir(opts.DataDir),
	}
	api := http.NewServeMux()
	a := s.requireAuth
	api.HandleFunc("GET /me", s.handleMe)
	api.HandleFunc("POST /login", s.handleLogin)
	api.HandleFunc("POST /logout", s.handleLogout)
	api.HandleFunc("POST /password", a(s.handlePassword))
	api.HandleFunc("GET /meta", a(s.handleMeta))
	api.HandleFunc("GET /overview", a(s.handleOverview))
	api.HandleFunc("GET /settings", a(s.handleGetSettings))
	api.HandleFunc("PUT /settings", a(s.handlePutSettings))
	api.HandleFunc("GET /audit", a(s.handleAudit))
	api.HandleFunc("GET /clients", a(s.handleClients))
	api.HandleFunc("POST /clients", a(s.handleCreateClient))
	api.HandleFunc("GET /clients/{id}", a(s.handleClient))
	api.HandleFunc("PUT /clients/{id}", a(s.handleUpdateClient))
	api.HandleFunc("DELETE /clients/{id}", a(s.handleDeleteClient))
	api.HandleFunc("POST /clients/{id}/reset-usage", a(s.handleResetUsage))
	api.HandleFunc("POST /clients/{id}/rotate-sub", a(s.handleRotateSub))
	api.HandleFunc("GET /clients/{id}/traffic", a(s.handleClientTraffic))
	api.HandleFunc("POST /clients/{id}/locations", a(s.handleCreateLocation))
	api.HandleFunc("PUT /locations/{id}", a(s.handleUpdateLocation))
	api.HandleFunc("DELETE /locations/{id}", a(s.handleDeleteLocation))
	api.HandleFunc("POST /locations/{id}/restart", a(s.handleRestartLocation))
	api.HandleFunc("POST /locations/{id}/rotate-key", a(s.handleRotateKey))
	api.HandleFunc("POST /locations/{id}/new-room", a(s.handleNewRoom))
	api.HandleFunc("GET /locations/{id}/logs", a(s.handleLogs))
	api.HandleFunc("GET /clients/{id}/devices", a(s.handleDevices))
	api.HandleFunc("POST /clients/{id}/devices", a(s.handleDeviceAction))
	api.HandleFunc("GET /backup", a(s.handleBackup))
	api.HandleFunc("POST /restore", a(s.handleRestore))
	api.HandleFunc("GET /system", a(s.handleSystem))

	root := http.NewServeMux()
	root.Handle(base+"api/", http.StripPrefix(strings.TrimSuffix(base, "/")+"/api", api))
	root.HandleFunc("GET /sub/{token}", s.handleSubscription)
	root.Handle(base, http.StripPrefix(base, s.spa()))
	root.HandleFunc(strings.TrimSuffix(base, "/"), func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, base, http.StatusFound)
	})
	return securityHeaders(root)
}

// spa serves the embedded frontend; unknown paths fall back to index.html.
func (s *Server) spa() http.Handler {
	files := http.FileServerFS(s.web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "" {
			if _, err := fs.Stat(s.web, r.URL.Path); err == nil {
				if strings.HasPrefix(r.URL.Path, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(s.web, "index.html")
		if err != nil {
			http.Error(w, "frontend not built", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func storeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, store.ErrConflict):
		writeErr(w, http.StatusConflict, "name already taken")
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request: "+err.Error())
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "bad id")
		return 0, false
	}
	return id, true
}

func (s *Server) panelName() string {
	if n := s.store.Setting(KeyPanelName); n != "" {
		return n
	}
	return "olc-ui"
}

func (s *Server) refresh() string {
	if v := s.store.Setting(KeyRefresh); v != "" {
		return v
	}
	return "1h"
}

func memStats() map[string]uint64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return map[string]uint64{"heap": m.HeapAlloc, "sys": m.Sys, "goroutines": uint64(runtime.NumGoroutine())}
}
