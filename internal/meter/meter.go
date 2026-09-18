// Package meter counts bytes on egress connections and optionally throttles
// them. One Meter is shared by every connection of a tunnel, so the limit is
// per tunnel (per client location), independently for each direction.
package meter

import (
	"context"
	"net"
	"sync/atomic"

	"golang.org/x/time/rate"
)

// Meter accumulates traffic and applies an optional speed limit.
type Meter struct {
	down   atomic.Uint64 // target -> client
	up     atomic.Uint64 // client -> target
	active atomic.Int64
	limDn  atomic.Pointer[rate.Limiter]
	limUp  atomic.Pointer[rate.Limiter]
}

// New returns a meter with the given limit in Mbit/s (0 = unlimited).
func New(mbps int) *Meter {
	m := &Meter{}
	m.SetLimit(mbps)
	return m
}

// SetLimit changes the speed limit for all current and future connections.
func (m *Meter) SetLimit(mbps int) {
	if mbps <= 0 {
		m.limDn.Store(nil)
		m.limUp.Store(nil)
		return
	}
	bps := float64(mbps) * 1_000_000 / 8
	burst := max(int(bps/10), 64<<10)
	m.limDn.Store(rate.NewLimiter(rate.Limit(bps), burst))
	m.limUp.Store(rate.NewLimiter(rate.Limit(bps), burst))
}

// Totals returns cumulative downloaded/uploaded bytes and open connections.
func (m *Meter) Totals() (down, up uint64, active int64) {
	return m.down.Load(), m.up.Load(), m.active.Load()
}

// Wrap returns conn instrumented by the meter.
func (m *Meter) Wrap(conn net.Conn) net.Conn {
	m.active.Add(1)
	return &conn_{Conn: conn, m: m}
}

type conn_ struct { //nolint:revive // private wrapper
	net.Conn
	m      *Meter
	closed atomic.Bool
}

func wait(l *rate.Limiter, n int) {
	if l == nil {
		return
	}
	for n > 0 {
		chunk := min(n, l.Burst())
		_ = l.WaitN(context.Background(), chunk)
		n -= chunk
	}
}

func (c *conn_) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		c.m.down.Add(uint64(n))
		wait(c.m.limDn.Load(), n)
	}
	return n, err //nolint:wrapcheck // transparent wrapper
}

func (c *conn_) Write(p []byte) (int, error) {
	wait(c.m.limUp.Load(), len(p))
	n, err := c.Conn.Write(p)
	if n > 0 {
		c.m.up.Add(uint64(n))
	}
	return n, err //nolint:wrapcheck // transparent wrapper
}

func (c *conn_) Close() error {
	if c.closed.CompareAndSwap(false, true) {
		c.m.active.Add(-1)
	}
	return c.Conn.Close() //nolint:wrapcheck // transparent wrapper
}

// CloseWrite forwards half-close when the underlying conn supports it.
func (c *conn_) CloseWrite() error {
	if cw, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return cw.CloseWrite() //nolint:wrapcheck // transparent wrapper
	}
	return nil
}
