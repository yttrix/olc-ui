package worker

import (
	"errors"
	"testing"
)

func TestGateCountsDevices(t *testing.T) {
	g := newGate(2)
	for _, d := range []string{"a", "b"} {
		if err := g.admit(d); err != nil {
			t.Fatal(err)
		}
		g.open("s-"+d, d)
	}
	if err := g.admit("c"); !errors.Is(err, ErrConnLimit) {
		t.Fatalf("third device err = %v", err)
	}
	// A reconnect of a known device is not a new device.
	if err := g.admit("a"); err != nil {
		t.Fatalf("reconnect rejected: %v", err)
	}
	g.close("s-b")
	if err := g.admit("c"); err != nil {
		t.Fatalf("slot not freed: %v", err)
	}
	g.setMax(0)
	if err := g.admit("d"); err != nil {
		t.Fatalf("unlimited rejected: %v", err)
	}
}
