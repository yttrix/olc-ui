// Package worker runs a single tunnel server (one client location) as a child
// process of the panel.
//
// Protocol with the parent:
//   - argv: path to a JSON Config file (deleted by the parent after start);
//   - stdout: one JSON Event per line;
//   - stderr: human-readable core logs;
//   - stdin: one JSON Command per line; EOF means the parent is gone and the
//     worker exits, so orphans never outlive the panel.
package worker

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/yttrix/olc-ui/core/pkg/olcrtc/tunnel"
	"github.com/yttrix/olc-ui/internal/meter"
	"github.com/yttrix/olc-ui/internal/spec"
)

// StatsInterval is how often the worker reports cumulative traffic.
const StatsInterval = 2 * time.Second

// Config is the worker input.
type Config struct {
	Endpoint  spec.Endpoint `json:"endpoint"`
	SpeedMbps int           `json:"speed_mbps"`
}

// Event types emitted on stdout.
const (
	EvStarted = "started"
	EvOpen    = "open"
	EvClose   = "close"
	EvStats   = "stats"
	EvHealth  = "health"
	EvExit    = "exit"
)

// Event is one line of worker output.
type Event struct {
	Type    string `json:"t"`
	Session string `json:"sid,omitempty"`
	Device  string `json:"dev,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Down    uint64 `json:"down,omitempty"`
	Up      uint64 `json:"up,omitempty"`
	Active  int64  `json:"active,omitempty"`
	RTTms   int64  `json:"rtt_ms,omitempty"`
	Missed  int    `json:"missed,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Command is one line of worker input.
type Command struct {
	Cmd       string `json:"cmd"` // "limit"
	SpeedMbps int    `json:"speed_mbps"`
}

type emitter struct {
	mu  sync.Mutex
	enc *json.Encoder
}

func (e *emitter) emit(ev Event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	_ = e.enc.Encode(ev)
}

// Main is the entry point for `olc-ui worker <config.json>`.
func Main(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: olc-ui worker <config.json>")
		return 2
	}
	raw, err := os.ReadFile(args[0])
	if err != nil {
		log.Printf("read config: %v", err)
		return 1
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		log.Printf("parse config: %v", err)
		return 1
	}
	cfg.Endpoint.Normalize()
	if err := cfg.Endpoint.Validate(); err != nil {
		log.Printf("invalid endpoint: %v", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	out := &emitter{enc: json.NewEncoder(os.Stdout)}
	err = Run(ctx, cfg, out.emit, os.Stdin)
	ev := Event{Type: EvExit}
	if err != nil && ctx.Err() == nil {
		ev.Error = err.Error()
	}
	out.emit(ev)
	if ev.Error != "" {
		return 1
	}
	return 0
}

// Run serves the tunnel until ctx ends, commands reach EOF or the core fails.
func Run(ctx context.Context, cfg Config, emit func(Event), commands io.Reader) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	m := meter.New(cfg.SpeedMbps)
	go readCommands(commands, m, cancel)
	go reportStats(ctx, m, emit)

	tc := cfg.Endpoint.TunnelConfig()
	tc.WrapEgress = m.Wrap
	tc.OnSessionOpen = func(sid, dev string, _ map[string]any) {
		emit(Event{Type: EvOpen, Session: sid, Device: dev})
	}
	tc.OnSessionClose = func(sid, reason string) {
		emit(Event{Type: EvClose, Session: sid, Reason: reason})
	}
	tc.OnHealth = func(st tunnel.HealthStatus) {
		emit(Event{Type: EvHealth, Session: st.SessionID, RTTms: st.LastRTT.Milliseconds(), Missed: st.MissedPongs})
	}
	emit(Event{Type: EvStarted})
	err := tunnel.New(tc).Run(ctx)
	down, up, _ := m.Totals()
	emit(Event{Type: EvStats, Down: down, Up: up})
	if err != nil {
		return fmt.Errorf("tunnel: %w", err)
	}
	return nil
}

func readCommands(r io.Reader, m *meter.Meter, cancel context.CancelFunc) {
	if r == nil {
		return
	}
	defer cancel()
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		var c Command
		if json.Unmarshal(sc.Bytes(), &c) != nil {
			continue
		}
		if c.Cmd == "limit" {
			m.SetLimit(c.SpeedMbps)
		}
	}
}

func reportStats(ctx context.Context, m *meter.Meter, emit func(Event)) {
	t := time.NewTicker(StatsInterval)
	defer t.Stop()
	var lastDown, lastUp uint64
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			down, up, active := m.Totals()
			if down == lastDown && up == lastUp {
				continue
			}
			lastDown, lastUp = down, up
			emit(Event{Type: EvStats, Down: down, Up: up, Active: active})
		}
	}
}
