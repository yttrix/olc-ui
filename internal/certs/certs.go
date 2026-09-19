// Package certs provides the panel TLS certificate: self-signed, user files
// (hot-reloaded on change) or Let's Encrypt via ACME HTTP-01 for a domain or a
// bare IP address (short-lived profile). Certificates are swapped in place, so
// renewals never restart the panel or drop tunnels.
package certs

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// Modes.
const (
	ModeSelf  = "self"
	ModeACME  = "acme"
	ModeFiles = "files"
	ModeOff   = "off"
)

// ErrNoHost is returned when ACME mode has no domain or IP to issue for.
var ErrNoHost = errors.New("acme: host (domain or IP) is required")

// Config selects how the certificate is obtained.
type Config struct {
	Mode     string
	Host     string // ACME: domain or IP address
	Email    string // ACME: optional contact
	HTTPPort int    // ACME: HTTP-01 listener port, default 80
	CA       string // ACME: directory URL, default Let's Encrypt production
	CertFile string // files mode
	KeyFile  string // files mode
	DataDir  string
}

// Status is shown in the panel settings.
type Status struct {
	Mode      string `json:"mode"`
	Host      string `json:"host,omitempty"`
	Issuer    string `json:"issuer,omitempty"`
	NotAfter  int64  `json:"not_after,omitempty"`
	LastError string `json:"last_error,omitempty"`
}

// Manager serves and maintains the current certificate.
type Manager struct {
	cfg     Config
	cur     atomic.Pointer[tls.Certificate]
	mu      sync.Mutex
	lastErr string
	modTime time.Time
}

// New loads the current certificate for cfg. In ACME mode a missing
// certificate is replaced by a self-signed one until issuance succeeds.
func New(cfg Config) (*Manager, error) {
	if cfg.Mode == "" || cfg.Mode == "auto" {
		cfg.Mode = ModeSelf
	}
	if cfg.HTTPPort == 0 {
		cfg.HTTPPort = 80
	}
	m := &Manager{cfg: cfg}
	switch cfg.Mode {
	case ModeOff:
		return m, nil
	case ModeFiles:
		return m, m.reloadFiles()
	case ModeACME:
		if cfg.Host == "" {
			return nil, ErrNoHost
		}
		if cert, err := tls.LoadX509KeyPair(m.acmePath("cert.pem"), m.acmePath("key.pem")); err == nil && m.covers(&cert) {
			m.set(&cert)
			return m, nil
		}
		fallthrough
	default:
		cert, err := SelfSigned(cfg.DataDir)
		if err != nil {
			return nil, err
		}
		m.set(&cert)
		return m, nil
	}
}

// Enabled reports whether the panel should serve HTTPS.
func (m *Manager) Enabled() bool { return m.cfg.Mode != ModeOff }

// TLSConfig returns a server config that always serves the current certificate.
func (m *Manager) TLSConfig() *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
			return m.cur.Load(), nil
		},
	}
}

// Status describes the current certificate.
func (m *Manager) Status() Status {
	st := Status{Mode: m.cfg.Mode, Host: m.cfg.Host}
	if c := m.cur.Load(); c != nil && c.Leaf != nil {
		st.NotAfter = c.Leaf.NotAfter.Unix()
		st.Issuer = c.Leaf.Issuer.CommonName
		if len(c.Leaf.Issuer.Organization) > 0 {
			st.Issuer = c.Leaf.Issuer.Organization[0]
		}
	}
	m.mu.Lock()
	st.LastError = m.lastErr
	m.mu.Unlock()
	return st
}

// Run keeps the certificate fresh until ctx ends.
func (m *Manager) Run(ctx context.Context) {
	if m.cfg.Mode != ModeACME && m.cfg.Mode != ModeFiles {
		return
	}
	for {
		wait := time.Minute
		switch m.cfg.Mode {
		case ModeFiles:
			if err := m.reloadFiles(); err != nil {
				m.setErr(err)
			}
		case ModeACME:
			wait = time.Hour
			if m.needsRenewal() {
				if err := m.Obtain(ctx); err != nil {
					m.setErr(err)
					log.Printf("certs: %v (retry in 1h)", err)
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (m *Manager) set(c *tls.Certificate) {
	if c.Leaf == nil && len(c.Certificate) > 0 {
		c.Leaf, _ = x509.ParseCertificate(c.Certificate[0])
	}
	m.cur.Store(c)
}

func (m *Manager) setErr(err error) {
	m.mu.Lock()
	m.lastErr = err.Error()
	m.mu.Unlock()
}

// reloadFiles loads user-supplied files when they change on disk (certbot or
// acme.sh renewals are picked up without a restart).
func (m *Manager) reloadFiles() error {
	st, err := os.Stat(m.cfg.CertFile)
	if err != nil {
		return fmt.Errorf("certificate file: %w", err)
	}
	if !st.ModTime().After(m.modTime) && m.cur.Load() != nil {
		return nil
	}
	cert, err := tls.LoadX509KeyPair(m.cfg.CertFile, m.cfg.KeyFile)
	if err != nil {
		return fmt.Errorf("load certificate: %w", err)
	}
	m.modTime = st.ModTime()
	m.set(&cert)
	m.mu.Lock()
	m.lastErr = ""
	m.mu.Unlock()
	return nil
}

func (m *Manager) acmePath(name string) string { return filepath.Join(m.cfg.DataDir, "acme", name) }

// covers reports whether c was issued for the configured host (the host may
// have been changed in the settings since the last issuance).
func (m *Manager) covers(c *tls.Certificate) bool {
	leaf, err := x509.ParseCertificate(c.Certificate[0])
	if err != nil {
		return false
	}
	if ip := net.ParseIP(m.cfg.Host); ip != nil {
		for _, a := range leaf.IPAddresses {
			if a.Equal(ip) {
				return true
			}
		}
		return false
	}
	return leaf.VerifyHostname(m.cfg.Host) == nil
}

// needsRenewal: renew when the self-signed placeholder is in use or when less
// than a third of the certificate lifetime is left (≈2 days for 6-day IP
// certificates, ≈30 days for 90-day domain certificates).
func (m *Manager) needsRenewal() bool {
	c := m.cur.Load()
	if c == nil || c.Leaf == nil || isSelfSigned(c.Leaf) {
		return true
	}
	life := c.Leaf.NotAfter.Sub(c.Leaf.NotBefore)
	return time.Until(c.Leaf.NotAfter) < life/3
}
