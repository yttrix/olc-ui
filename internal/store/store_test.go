package store

import (
	"context"
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
