package certs

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"

	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge/http01"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/registration"
)

// Let's Encrypt only issues IP-address certificates under the short-lived
// profile (≈6 days); domains use the default 90-day profile.
const shortLivedProfile = "shortlived"

type acmeUser struct {
	Email        string                 `json:"email"`
	Registration *registration.Resource `json:"registration"`
	key          crypto.PrivateKey
}

func (u *acmeUser) GetEmail() string                        { return u.Email }
func (u *acmeUser) GetRegistration() *registration.Resource { return u.Registration }
func (u *acmeUser) GetPrivateKey() crypto.PrivateKey        { return u.key }

// Obtain issues a certificate for the configured host now and swaps it in.
func (m *Manager) Obtain(ctx context.Context) error {
	if m.cfg.Mode != ModeACME {
		return errors.New("certs: not in acme mode")
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("acme: %w", err)
	}
	user, err := m.loadUser()
	if err != nil {
		return err
	}
	lc := lego.NewConfig(user)
	if m.cfg.CA != "" {
		lc.CADirURL = m.cfg.CA
	}
	client, err := lego.NewClient(lc)
	if err != nil {
		return fmt.Errorf("acme client: %w", err)
	}
	srv := http01.NewProviderServer("", strconv.Itoa(m.cfg.HTTPPort))
	if err := client.Challenge.SetHTTP01Provider(srv); err != nil {
		return fmt.Errorf("acme http-01: %w", err)
	}
	if user.Registration == nil {
		reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
		if err != nil {
			return fmt.Errorf("acme register: %w", err)
		}
		user.Registration = reg
		if err := m.saveUser(user); err != nil {
			return err
		}
	}
	req := certificate.ObtainRequest{Domains: []string{m.cfg.Host}, Bundle: true}
	if net.ParseIP(m.cfg.Host) != nil {
		req.Profile = shortLivedProfile
	}
	res, err := client.Certificate.Obtain(req)
	if err != nil {
		return fmt.Errorf("acme obtain for %s (is TCP port %d open to the internet?): %w", m.cfg.Host, m.cfg.HTTPPort, err)
	}
	if err := writeFiles(m.acmePath("cert.pem"), res.Certificate, m.acmePath("key.pem"), res.PrivateKey); err != nil {
		return err
	}
	cert, err := tls.X509KeyPair(res.Certificate, res.PrivateKey)
	if err != nil {
		return fmt.Errorf("acme: load issued certificate: %w", err)
	}
	m.set(&cert)
	m.mu.Lock()
	m.lastErr = ""
	m.mu.Unlock()
	log.Printf("certs: issued certificate for %s, valid until %s", m.cfg.Host, cert.Leaf.NotAfter.Format("2006-01-02 15:04"))
	return nil
}

func (m *Manager) loadUser() (*acmeUser, error) {
	u := &acmeUser{Email: m.cfg.Email}
	if raw, err := os.ReadFile(m.acmePath("account.json")); err == nil {
		_ = json.Unmarshal(raw, u)
		if m.cfg.Email != "" {
			u.Email = m.cfg.Email
		}
	}
	if raw, err := os.ReadFile(m.acmePath("account.key")); err == nil {
		if block, _ := pem.Decode(raw); block != nil {
			if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
				u.key = key
				return u, nil
			}
		}
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("acme account key: %w", err)
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("acme account key: %w", err)
	}
	if err := os.MkdirAll(m.acmePath(""), 0o700); err != nil {
		return nil, fmt.Errorf("acme dir: %w", err)
	}
	if err := os.WriteFile(m.acmePath("account.key"), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		return nil, fmt.Errorf("acme account key: %w", err)
	}
	u.key, u.Registration = key, nil
	return u, nil
}

func (m *Manager) saveUser(u *acmeUser) error {
	raw, err := json.Marshal(u)
	if err != nil {
		return fmt.Errorf("acme account: %w", err)
	}
	if err := os.WriteFile(m.acmePath("account.json"), raw, 0o600); err != nil {
		return fmt.Errorf("acme account: %w", err)
	}
	return nil
}
