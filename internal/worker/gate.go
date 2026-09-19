package worker

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrConnLimit rejects a handshake over the client's connection limit.
var ErrConnLimit = errors.New("connection limit reached")

// pendingTTL covers the gap between an admitted handshake and its session
// open event, so parallel handshakes cannot overshoot the limit.
const pendingTTL = 30 * time.Second

// gate limits how many distinct devices hold tunnel sessions at once. It
// counts devices, not sessions: a device that reconnects while its previous
// session is still being torn down is let through instead of being locked out
// by its own stale session.
type gate struct {
	mu       sync.Mutex
	max      int
	sessions map[string]string    // session id -> device id
	pending  map[string]time.Time // admitted device -> admission time
}

func newGate(max int) *gate {
	return &gate{max: max, sessions: map[string]string{}, pending: map[string]time.Time{}}
}

func (g *gate) setMax(max int) {
	g.mu.Lock()
	g.max = max
	g.mu.Unlock()
}

func (g *gate) admit(dev string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	active := map[string]bool{}
	for _, d := range g.sessions {
		active[d] = true
	}
	for d, t := range g.pending {
		if now.Sub(t) > pendingTTL {
			delete(g.pending, d)
			continue
		}
		active[d] = true
	}
	if g.max > 0 && !active[dev] && len(active) >= g.max {
		return fmt.Errorf("%w: %d of %d devices connected", ErrConnLimit, len(active), g.max)
	}
	g.pending[dev] = now
	return nil
}

func (g *gate) open(sid, dev string) {
	g.mu.Lock()
	g.sessions[sid] = dev
	delete(g.pending, dev)
	g.mu.Unlock()
}

func (g *gate) close(sid string) {
	g.mu.Lock()
	delete(g.sessions, sid)
	g.mu.Unlock()
}
