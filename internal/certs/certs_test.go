package certs

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSelfSignedAndFilesReload(t *testing.T) {
	dir := t.TempDir()
	m, err := New(Config{Mode: ModeSelf, DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	c, _ := m.TLSConfig().GetCertificate(&tls.ClientHelloInfo{})
	if c == nil || !isSelfSigned(c.Leaf) {
		t.Fatal("expected a self-signed certificate")
	}

	// Files mode picks the new pair up once the file changes on disk.
	other := t.TempDir()
	if _, err := SelfSigned(other); err != nil {
		t.Fatal(err)
	}
	fm, err := New(Config{Mode: ModeFiles, CertFile: filepath.Join(dir, "cert.pem"), KeyFile: filepath.Join(dir, "key.pem")})
	if err != nil {
		t.Fatal(err)
	}
	first := fm.cur.Load()
	for _, f := range []string{"cert.pem", "key.pem"} {
		raw, _ := os.ReadFile(filepath.Join(other, f))
		_ = os.WriteFile(filepath.Join(dir, f), raw, 0o600)
	}
	future := time.Now().Add(time.Minute)
	_ = os.Chtimes(filepath.Join(dir, "cert.pem"), future, future)
	if err := fm.reloadFiles(); err != nil {
		t.Fatal(err)
	}
	if fm.cur.Load() == first {
		t.Fatal("certificate was not reloaded")
	}
}

func TestACMEFallsBackToSelfSigned(t *testing.T) {
	m, err := New(Config{Mode: ModeACME, Host: "203.0.113.7", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if !m.needsRenewal() {
		t.Fatal("placeholder certificate must trigger issuance")
	}
	if _, err := New(Config{Mode: ModeACME, DataDir: t.TempDir()}); err == nil {
		t.Fatal("acme without host must fail")
	}
}
