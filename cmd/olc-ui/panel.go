package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/yttrix/olc-ui/internal/api"
	"github.com/yttrix/olc-ui/internal/store"
	"github.com/yttrix/olc-ui/internal/supervisor"
	"github.com/yttrix/olc-ui/internal/web"
)

const keyBasePath = "base_path"

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type panelFlags struct {
	data, listen, tlsMode, cert, key, base string
}

func parsePanelFlags(name string, args []string) (*flag.FlagSet, *panelFlags) {
	f := &panelFlags{}
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	fs.StringVar(&f.data, "data", envOr("OLCUI_DATA", "/var/lib/olc-ui"), "data directory (database, certificates)")
	fs.StringVar(&f.listen, "listen", envOr("OLCUI_LISTEN", ":2053"), "listen address")
	fs.StringVar(&f.tlsMode, "tls", envOr("OLCUI_TLS", "auto"), "auto (self-signed), off, or files")
	fs.StringVar(&f.cert, "cert", envOr("OLCUI_CERT", ""), "certificate file for -tls files")
	fs.StringVar(&f.key, "key", envOr("OLCUI_KEY", ""), "private key file for -tls files")
	fs.StringVar(&f.base, "base", envOr("OLCUI_BASE", ""), "panel path, e.g. /secret/ (default: random, saved)")
	_ = fs.Parse(args)
	return fs, f
}

func openStore(f *panelFlags) (*store.Store, string, error) {
	if err := os.MkdirAll(f.data, 0o700); err != nil {
		return nil, "", fmt.Errorf("data dir: %w", err)
	}
	st, err := store.Open(filepath.Join(f.data, "olc-ui.db"))
	if err != nil {
		return nil, "", err //nolint:wrapcheck // already contextual
	}
	base := f.base
	if base == "" {
		base = st.Setting(keyBasePath)
	}
	if base == "" {
		base = "/" + store.RandomToken(6) + "/"
	}
	base = "/" + strings.Trim(base, "/") + "/"
	if base == "//" {
		base = "/"
	}
	if err := st.SetSetting(keyBasePath, base); err != nil {
		return nil, "", err //nolint:wrapcheck // already contextual
	}
	return st, base, nil
}

func panelMain(args []string) int {
	_, f := parsePanelFlags("panel", args)
	st, base, err := openStore(f)
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	defer st.Close()
	if !api.HasAdmin(st) {
		pass := store.RandomToken(8)
		if err := api.SetAdmin(st, "admin", pass); err != nil {
			log.Printf("init admin: %v", err)
			return 1
		}
		log.Printf("created admin account: login admin, password %s (change it in Settings)", pass)
	}

	exe, err := os.Executable()
	if err != nil {
		log.Printf("locate executable: %v", err)
		return 1
	}
	tmp := filepath.Join(f.data, "run")
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		log.Printf("run dir: %v", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	sup := supervisor.New(st, exe, tmp)
	supDone := make(chan struct{})
	go func() { sup.Run(ctx); close(supDone) }()

	srv := &http.Server{
		Addr:              f.listen,
		Handler:           api.New(st, sup, base, web.FS(), version),
		ReadHeaderTimeout: 10 * time.Second,
		ErrorLog:          log.New(tlsNoise{}, "", 0),
	}
	errCh := make(chan error, 1)
	go func() { errCh <- serve(srv, f) }()
	scheme := "https"
	if f.tlsMode == "off" {
		scheme = "http"
	}
	log.Printf("olc-ui %s panel: %s://<server-ip>%s%s", version, scheme, portSuffix(f.listen), base)

	select {
	case <-ctx.Done():
	case err := <-errCh:
		log.Printf("http: %v", err)
		stop()
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
	<-supDone
	return 0
}

func serve(srv *http.Server, f *panelFlags) error {
	var err error
	switch f.tlsMode {
	case "off":
		err = srv.ListenAndServe()
	case "files":
		err = srv.ListenAndServeTLS(f.cert, f.key)
	default:
		var cert tls.Certificate
		cert, err = selfSigned(f.data)
		if err != nil {
			return err
		}
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		err = srv.ListenAndServeTLS("", "")
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err //nolint:wrapcheck // logged by caller
}

func portSuffix(listen string) string {
	if i := strings.LastIndex(listen, ":"); i >= 0 {
		return listen[i:]
	}
	return ""
}

// tlsNoise drops the constant "TLS handshake error" lines produced by
// scanners and browsers rejecting the self-signed certificate.
type tlsNoise struct{}

func (tlsNoise) Write(p []byte) (int, error) {
	if !strings.Contains(string(p), "TLS handshake error") {
		log.Print(strings.TrimRight(string(p), "\n"))
	}
	return len(p), nil
}

// adminMain sets admin credentials and prints how to open the panel. Used by
// the installer and for password recovery: olc-ui admin [-user u] [-pass p].
func adminMain(args []string) int {
	fs := flag.NewFlagSet("admin", flag.ExitOnError)
	user := fs.String("user", "admin", "admin login")
	pass := fs.String("pass", "", "admin password (random when empty)")
	_ = fs.Parse(filterFlags(args, true))
	_, f := parsePanelFlags("admin", filterFlags(args, false))
	st, base, err := openStore(f)
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	defer st.Close()
	if *pass == "" {
		*pass = store.RandomToken(8)
	}
	if err := api.SetAdmin(st, *user, *pass); err != nil {
		log.Printf("set admin: %v", err)
		return 1
	}
	fmt.Printf("path=%s\nuser=%s\npass=%s\n", base, *user, *pass)
	return 0
}

// filterFlags splits admin-only flags (user/pass) from panel flags.
func filterFlags(args []string, adminOnly bool) []string {
	out := []string{}
	for i := 0; i < len(args); i++ {
		a := strings.TrimLeft(args[i], "-")
		isAdmin := strings.HasPrefix(a, "user") || strings.HasPrefix(a, "pass")
		take := 1
		if !strings.Contains(a, "=") && i+1 < len(args) && strings.HasPrefix(args[i], "-") {
			take = 2
		}
		if isAdmin == adminOnly {
			out = append(out, args[i:min(i+take, len(args))]...)
		}
		i += take - 1
	}
	return out
}

// infoMain prints the saved panel path (used by the installer on upgrades).
func infoMain(args []string) int {
	_, f := parsePanelFlags("info", args)
	st, base, err := openStore(f)
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	defer st.Close()
	fmt.Printf("path=%s\nuser=%s\n", base, st.Setting("admin_user"))
	return 0
}
