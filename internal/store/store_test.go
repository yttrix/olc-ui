package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/yttrix/olc-ui/internal/spec"
)

func TestClientLifecycle(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	c := &Client{Name: "alice", Enabled: true, TrafficLimit: 1000}
	if err := s.SaveClient(c); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveClient(&Client{Name: "alice"}); err != ErrConflict {
		t.Fatalf("duplicate name err = %v", err)
	}
	loc := &Location{ClientID: c.ID, Name: "NL", Enabled: true, Endpoint: spec.Endpoint{Provider: "jitsi", Room: "https://h/r"}}
	if err := s.SaveLocation(loc); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	if err := s.AddUsage(context.Background(), map[int64][2]uint64{c.ID: {600, 500}}, now); err != nil {
		t.Fatal(err)
	}
	got, err := s.ClientBySubToken(c.SubToken)
	if err != nil {
		t.Fatal(err)
	}
	if got.UsedBytes != 1100 || len(got.Locations) != 1 || got.Locations[0].Endpoint.Room != "https://h/r" {
		t.Fatalf("unexpected client %+v", got)
	}
	if got.Status(now) != StatusOverQuot {
		t.Fatalf("status = %s", got.Status(now))
	}
	tr, _ := s.Traffic(c.ID, 3, now)
	if len(tr) != 3 || tr[2].Down != 600 || tr[0].Down != 0 {
		t.Fatalf("traffic = %+v", tr)
	}
	if err := s.DeleteClient(c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Location(loc.ID); err != ErrNotFound {
		t.Fatalf("cascade failed: %v", err)
	}
}

func TestBackupRestoreAndDevices(t *testing.T) {
	dir := t.TempDir()
	src, err := Open(filepath.Join(dir, "src.db"))
	if err != nil {
		t.Fatal(err)
	}
	c := &Client{Name: "bob", Enabled: true, MaxDevices: 1}
	if err := src.SaveClient(c); err != nil {
		t.Fatal(err)
	}
	_ = src.SaveLocation(&Location{ClientID: c.ID, Enabled: true, Endpoint: spec.Endpoint{Provider: "wbstream", Room: "r1"}})
	_ = src.SetSetting("panel_name", "Old VPS")
	_ = src.SetSetting("admin_user", "old-admin")

	if err := src.TouchDevice(c.ID, "install-a", "Olcbox/1.0", "1.1.1.1", c.MaxDevices); err != nil {
		t.Fatal(err)
	}
	if err := src.TouchDevice(c.ID, "install-b", "Olcbox/1.0", "1.1.1.2", c.MaxDevices); err != ErrDeviceLimit {
		t.Fatalf("second device err = %v", err)
	}
	if err := src.TouchDevice(c.ID, "install-a", "Olcbox/1.1", "1.1.1.1", c.MaxDevices); err != nil {
		t.Fatalf("known device must pass: %v", err)
	}
	if other, used := src.RoomInUse("wbstream", "R1", 0); !used || other == "" {
		t.Fatal("room reuse not detected")
	}

	bk := filepath.Join(dir, "backup.db")
	if err := src.Backup(bk); err != nil {
		t.Fatal(err)
	}

	dst, err := Open(filepath.Join(dir, "dst.db"))
	if err != nil {
		t.Fatal(err)
	}
	_ = dst.SetSetting("admin_user", "new-admin")
	_ = dst.SaveClient(&Client{Name: "stale", Enabled: true})
	sum, err := dst.Restore(context.Background(), bk)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Clients != 1 || sum.Locations != 1 {
		t.Fatalf("summary %+v", sum)
	}
	got, err := dst.Clients()
	if err != nil || len(got) != 1 || got[0].Name != "bob" || got[0].SubToken != c.SubToken || got[0].MaxDevices != 1 {
		t.Fatalf("restored clients %+v %v", got, err)
	}
	if devs, _ := dst.Devices(got[0].ID); len(devs) != 1 {
		t.Fatalf("devices not restored: %+v", devs)
	}
	if dst.Setting("panel_name") != "Old VPS" || dst.Setting("admin_user") != "new-admin" {
		t.Fatal("settings restore rules violated")
	}
	if _, err := dst.Restore(context.Background(), filepath.Join(dir, "missing.db")); err == nil {
		t.Fatal("restoring a non-backup must fail")
	}
}

func TestMigrateFromV01(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	// v0.1 clients table, before max_conns/max_devices/last_online.
	if _, err := db.Exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
		note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, speed_mbps INTEGER NOT NULL DEFAULT 0,
		traffic_limit INTEGER NOT NULL DEFAULT 0, used_bytes INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL DEFAULT '',
		refresh TEXT NOT NULL DEFAULT '', sub_token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
		INSERT INTO clients(name,sub_token,created_at,used_bytes) VALUES('legacy','tok',1,42);`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.ClientBySubToken("tok")
	if err != nil || c.Name != "legacy" || c.UsedBytes != 42 || c.MaxConns != 3 {
		t.Fatalf("migrated client %+v %v", c, err)
	}
}
