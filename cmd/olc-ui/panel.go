package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/yttrix/olc-ui/internal/api"
	"github.com/yttrix/olc-ui/internal/certs"
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
	data, listen, base                     string
	tlsMode, tlsHost, cert, key, acmeEmail string
	acmeCA                                 string
	acmePort                               int
}

// parsePanelFlags parses panel flags; every flag also has an OLCUI_* env
// variable so systemd can configure the service from /etc/olc-ui/olc-ui.env.
func parsePanelFlags(name string, args []string) (*flag.FlagSet, *panelFlags) {
	f := &panelFlags{}
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	fs.StringVar(&f.data, "data", envOr("OLCUI_DATA", "/var/lib/olc-ui"), "data directory (database, certificates)")
	fs.StringVar(&f.listen, "listen", envOr("OLCUI_LISTEN", ":2053"), "listen address")
	fs.StringVar(&f.base, "base", envOr("OLCUI_BASE", ""), "panel path, e.g. /secret/ (default: random, saved)")
	fs.StringVar(&f.tlsMode, "tls", envOr("OLCUI_TLS", "self"), "self (self-signed), acme (Let's Encrypt), files, off")
	fs.StringVar(&f.tlsHost, "tls-host", envOr("OLCUI_TLS_HOST", ""), "acme: domain or public IP to issue the certificate for")
	fs.StringVar(&f.cert, "cert", envOr("OLCUI_CERT", ""), "files: certificate (fullchain) path")
	fs.StringVar(&f.key, "key", envOr("OLCUI_KEY", ""), "files: private key path")
	fs.StringVar(&f.acmeEmail, "acme-email", envOr("OLCUI_ACME_EMAIL", ""), "acme: optional contact e-mail")
	fs.StringVar(&f.acmeCA, "acme-ca", envOr("OLCUI_ACME_CA", ""), "acme: directory URL (default Let's Encrypt)")
	port, _ := strconv.Atoi(envOr("OLCUI_ACME_PORT", "80"))
	fs.IntVar(&f.acmePort, "acme-port", port, "acme: HTTP-01 challenge port")
	_ = fs.Parse(args)
	if f.tlsMode == "auto" {
		f.tlsMode = certs.ModeSelf
	}
	return fs, f
}

func (f *panelFlags) certConfig() certs.Config {
	return certs.Config{
		Mode: f.tlsMode, Host: f.tlsHost, Email: f.acmeEmail, HTTPPort: f.acmePort, CA: f.acmeCA,
		CertFile: f.cert, KeyFile: f.key, DataDir: f.data,
	}
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
	cm, err := certs.New(f.certConfig())
	if err != nil {
		log.Printf("tls: %v", err)
		return 1
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
	go cm.Run(ctx)

	srv := &http.Server{
		Addr: f.listen,
		Handler: api.New(st, sup, base, web.FS(), version, api.Options{
			DataDir:    f.data,
			CertStatus: func() any { return cm.Status() },
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute, // backup uploads
		WriteTimeout:      5 * time.Minute, // backup downloads
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          log.New(tlsNoise{}, "", 0),
	}
	errCh := make(chan error, 1)
	go func() {
		var err error
		if cm.Enabled() {
			srv.TLSConfig = cm.TLSConfig()
			err = srv.ListenAndServeTLS("", "")
		} else {
			err = srv.ListenAndServe()
		}
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errCh <- err
	}()
	scheme := "https"
	if !cm.Enabled() {
		scheme = "http"
	}
	host := f.tlsHost
	if host == "" {
		host = "<server-ip>"
	}
	log.Printf("olc-ui %s panel: %s://%s%s%s (tls: %s)", version, scheme, host, portSuffix(f.listen), base, f.tlsMode)

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil {
			log.Printf("http: %v", err)
		}
		stop()
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
	<-supDone
	return 0
}

func portSuffix(listen string) string {
	if i := strings.LastIndex(listen, ":"); i >= 0 {
		return listen[i:]
	}
	return ""
}

// tlsNoise drops the constant "TLS handshake error" lines produced by
// scanners and browsers rejecting a self-signed certificate.
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

// infoMain prints the saved panel path and login (installer, menu).
func infoMain(args []string) int {
	_, f := parsePanelFlags("info", filterFlags(args, false))
	st, base, err := openStore(f)
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	defer st.Close()
	fmt.Printf("path=%s\nuser=%s\n", base, st.Setting("admin_user"))
	return 0
}

// certMain issues a Let's Encrypt certificate now (installer, menu) so any
// problem (closed port 80, wrong DNS) is reported immediately.
func certMain(args []string) int {
	_, f := parsePanelFlags("cert", args)
	if f.tlsMode != certs.ModeACME {
		fmt.Fprintln(os.Stderr, "cert: set -tls acme (OLCUI_TLS=acme) and -tls-host")
		return 2
	}
	cm, err := certs.New(f.certConfig())
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := cm.Obtain(ctx); err != nil {
		log.Printf("%v", err)
		return 1
	}
	st := cm.Status()
	fmt.Printf("issuer=%s\nnot_after=%s\n", st.Issuer, time.Unix(st.NotAfter, 0).Format(time.RFC3339))
	return 0
}

// backupMain writes a database snapshot: olc-ui backup [-o file].
func backupMain(args []string) int {
	fs := flag.NewFlagSet("backup", flag.ExitOnError)
	out := fs.String("o", "olc-ui-backup-"+time.Now().Format("2006-01-02-1504")+".db", "output file")
	_ = fs.Parse(filterFlags(args, true))
	_, f := parsePanelFlags("backup", filterFlags(args, false))
	st, _, err := openStore(f)
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	defer st.Close()
	path, _ := filepath.Abs(*out)
	if err := st.Backup(path); err != nil {
		log.Printf("%v", err)
		return 1
	}
	fmt.Println(path)
	return 0
}

// restoreMain restores clients from a backup: olc-ui restore <file>.
func restoreMain(args []string) int {
	_, f := parsePanelFlags("restore", filterFlags(args, false))
	files := filterFlags(args, true)
	if len(files) != 1 {
		fmt.Fprintln(os.Stderr, "usage: olc-ui restore <backup.db>")
		return 2
	}
	st, _, err := openStore(f)
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	defer st.Close()
	sum, err := st.Restore(context.Background(), files[0])
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	st.Audit("backup_restored", fmt.Sprintf("cli: %d clients, %d locations", sum.Clients, sum.Locations))
	fmt.Printf("restored %d clients, %d locations\n", sum.Clients, sum.Locations)
	return 0
}

// panelFlagNames are handled by parsePanelFlags; everything else belongs to
// the subcommand.
var panelFlagNames = []string{ //nolint:gochecknoglobals // static list
	"data", "listen", "base", "tls", "tls-host", "cert", "key", "acme-email", "acme-ca", "acme-port",
}

// filterFlags splits subcommand arguments (own=true) from panel flags.
func filterFlags(args []string, own bool) []string {
	out := []string{}
	for i := 0; i < len(args); i++ {
		a := args[i]
		name := strings.TrimLeft(a, "-")
		name, _, hasValue := strings.Cut(name, "=")
		isPanel := strings.HasPrefix(a, "-")
		if isPanel {
			isPanel = false
			for _, n := range panelFlagNames {
				if n == name {
					isPanel = true
				}
			}
		}
		take := 1
		if strings.HasPrefix(a, "-") && !hasValue && i+1 < len(args) {
			take = 2
		}
		if isPanel != own {
			out = append(out, args[i:min(i+take, len(args))]...)
		}
		i += take - 1
	}
	return out
}
