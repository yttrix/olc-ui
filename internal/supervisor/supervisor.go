// Package supervisor keeps one worker process running per active client
// location, restarts crashed workers with backoff, collects their events and
// logs, accounts traffic into the store and enforces client quotas.
package supervisor

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yttrix/olc-ui/internal/store"
	"github.com/yttrix/olc-ui/internal/worker"
)

const (
	tickInterval = 10 * time.Second
	stopTimeout  = 5 * time.Second
	logLines     = 500
	maxBackoff   = time.Minute
)

// Runtime status values.
const (
	StatusRunning = "running"
	StatusBackoff = "restarting"
	StatusStopped = "stopped"
)

// Peer is a client device currently connected to a location.
type Peer struct {
	Session string `json:"session"`
	Device  string `json:"device"`
	Since   int64  `json:"since"`
}

// Runtime is the observable state of one location.
type Runtime struct {
	Status      string `json:"status"`
	Reason      string `json:"reason,omitempty"` // why stopped
	PID         int    `json:"pid,omitempty"`
	StartedAt   int64  `json:"started_at,omitempty"`
	Restarts    int    `json:"restarts"`
	LastError   string `json:"last_error,omitempty"`
	Peers       []Peer `json:"peers"`
	Down        uint64 `json:"down"`
	Up          uint64 `json:"up"`
	RateDown    uint64 `json:"rate_down"` // bytes/s
	RateUp      uint64 `json:"rate_up"`
	Conns       int64  `json:"conns"`
	RTTms       int64  `json:"rtt_ms,omitempty"`
	MemoryBytes uint64 `json:"memory_bytes,omitempty"`
}

// LogLine is one captured worker log line.
type LogLine struct {
	TS   int64  `json:"ts"`
	Line string `json:"line"`
}

// Supervisor owns all worker processes.
type Supervisor struct {
	store   *store.Store
	exe     string
	tmpDir  string
	mu      sync.Mutex
	procs   map[int64]*proc
	stopped map[int64]string // location id -> reason it is not running
	pending map[int64][2]uint64
	kick    chan struct{}
	wg      sync.WaitGroup
}

type proc struct {
	loc      store.Location
	hash     string
	speed    int
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	done     chan struct{}
	stopping bool
	rt       Runtime
	logs     []LogLine
	lastStat time.Time
	backoff  time.Duration
	retryAt  time.Time
}

// New creates a supervisor that spawns `exe worker` processes.
func New(st *store.Store, exe, tmpDir string) *Supervisor {
	return &Supervisor{
		store: st, exe: exe, tmpDir: tmpDir,
		procs: map[int64]*proc{}, stopped: map[int64]string{}, pending: map[int64][2]uint64{},
		kick: make(chan struct{}, 1),
	}
}

// Kick asks the supervisor to reconcile now (after config changes).
func (s *Supervisor) Kick() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

// Run reconciles until ctx ends, then stops every worker.
func (s *Supervisor) Run(ctx context.Context) {
	t := time.NewTicker(tickInterval)
	defer t.Stop()
	s.reconcile()
	for {
		select {
		case <-ctx.Done():
			s.flushUsage()
			s.stopAll()
			return
		case <-t.C:
		case <-s.kick:
		}
		s.flushUsage()
		s.reconcile()
	}
}

func (s *Supervisor) flushUsage() {
	s.mu.Lock()
	pending := s.pending
	s.pending = map[int64][2]uint64{}
	s.mu.Unlock()
	if len(pending) == 0 {
		return
	}
	if err := s.store.AddUsage(context.Background(), pending, time.Now()); err != nil {
		log.Printf("supervisor: save usage: %v", err)
	}
}

func (s *Supervisor) reconcile() {
	clients, err := s.store.Clients()
	if err != nil {
		log.Printf("supervisor: load clients: %v", err)
		return
	}
	now := time.Now()
	want := map[int64]store.Location{}
	speed := map[int64]int{}
	stopped := map[int64]string{}
	for _, c := range clients {
		status := c.Status(now)
		for _, l := range c.Locations {
			switch {
			case status != store.StatusActive:
				stopped[l.ID] = status
			case !l.Enabled:
				stopped[l.ID] = store.StatusDisabled
			default:
				want[l.ID] = l
				speed[l.ID] = c.SpeedMbps
			}
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopped = stopped
	for id, p := range s.procs {
		l, ok := want[id]
		if !ok || locHash(l) != p.hash {
			s.stopLocked(id, p)
		}
	}
	for id, l := range want {
		p := s.procs[id]
		if p == nil {
			s.startLocked(l, speed[id], 0, 0)
			continue
		}
		if p.cmd == nil && now.After(p.retryAt) {
			s.startLocked(l, speed[id], p.rt.Restarts+1, p.backoff)
			continue
		}
		if p.speed != speed[id] && p.stdin != nil {
			p.speed = speed[id]
			_ = json.NewEncoder(p.stdin).Encode(worker.Command{Cmd: "limit", SpeedMbps: p.speed})
		}
	}
}

func locHash(l store.Location) string {
	raw, _ := json.Marshal(l.Endpoint)
	return string(raw)
}

func (s *Supervisor) startLocked(l store.Location, speed, restarts int, backoff time.Duration) {
	p := &proc{loc: l, hash: locHash(l), speed: speed, done: make(chan struct{}), backoff: backoff}
	p.rt = Runtime{Status: StatusBackoff, Restarts: restarts, Peers: []Peer{}}
	if old := s.procs[l.ID]; old != nil {
		p.logs = old.logs // keep history across crash restarts
	}
	s.procs[l.ID] = p

	cfgPath, err := s.writeConfig(l, speed)
	if err != nil {
		s.failLocked(p, err)
		return
	}
	cmd := exec.Command(s.exe, "worker", cfgPath) //nolint:gosec // our own binary
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		_ = os.Remove(cfgPath)
		s.failLocked(p, err)
		return
	}
	p.cmd, p.stdin = cmd, stdin
	p.rt.Status, p.rt.PID, p.rt.StartedAt = StatusRunning, cmd.Process.Pid, time.Now().Unix()
	log.Printf("supervisor: started location %d (%s/%s) pid %d", l.ID, l.Endpoint.Provider, l.Endpoint.Transport, p.rt.PID)

	var readers sync.WaitGroup
	readers.Add(2)
	go func() { defer readers.Done(); s.readEvents(p, stdout) }()
	go func() { defer readers.Done(); s.readLogs(p, stderr) }()
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		readers.Wait()
		err := cmd.Wait()
		_ = os.Remove(cfgPath)
		s.exited(p, err)
	}()
}

func (s *Supervisor) writeConfig(l store.Location, speed int) (string, error) {
	raw, err := json.Marshal(worker.Config{Endpoint: l.Endpoint, SpeedMbps: speed})
	if err != nil {
		return "", fmt.Errorf("marshal worker config: %w", err)
	}
	f, err := os.CreateTemp(s.tmpDir, "worker-*.json")
	if err != nil {
		return "", fmt.Errorf("worker config: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(raw); err != nil {
		return "", fmt.Errorf("worker config: %w", err)
	}
	return f.Name(), nil
}

func (s *Supervisor) failLocked(p *proc, err error) {
	p.rt.LastError = err.Error()
	p.cmd, p.stdin = nil, nil
	p.backoff = min(max(p.backoff*2, 2*time.Second), maxBackoff)
	p.retryAt = time.Now().Add(p.backoff)
	p.rt.Status, p.rt.PID, p.rt.Peers, p.rt.RateDown, p.rt.RateUp, p.rt.Conns = StatusBackoff, 0, []Peer{}, 0, 0, 0
	p.appendLog(fmt.Sprintf("[olc-ui] worker failed: %v; retry in %s", err, p.backoff))
	time.AfterFunc(p.backoff, s.Kick)
}

func (s *Supervisor) exited(p *proc, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	close(p.done)
	if p.stopping || s.procs[p.loc.ID] != p {
		return
	}
	if err == nil {
		err = errors.New("worker exited")
	}
	if p.rt.LastError != "" {
		err = fmt.Errorf("%w: %s", err, p.rt.LastError)
	}
	// A worker that ran for a while is healthy; restart it quickly.
	if time.Since(time.Unix(p.rt.StartedAt, 0)) > 2*time.Minute {
		p.backoff = 0
	}
	s.failLocked(p, err)
}

func (s *Supervisor) stopLocked(id int64, p *proc) {
	delete(s.procs, id)
	p.stopping = true
	if p.cmd == nil {
		return
	}
	_ = p.stdin.Close()
	go func() {
		select {
		case <-p.done:
		case <-time.After(stopTimeout):
			_ = p.cmd.Process.Kill()
		}
	}()
}

func (s *Supervisor) stopAll() {
	s.mu.Lock()
	for id, p := range s.procs {
		s.stopLocked(id, p)
	}
	s.mu.Unlock()
	s.wg.Wait()
}

// Restart restarts one location immediately.
func (s *Supervisor) Restart(locationID int64) {
	s.mu.Lock()
	if p := s.procs[locationID]; p != nil {
		s.stopLocked(locationID, p)
	}
	s.mu.Unlock()
	s.Kick()
}

func (s *Supervisor) readEvents(p *proc, r io.Reader) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		var ev worker.Event
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		s.mu.Lock()
		s.applyEvent(p, ev)
		s.mu.Unlock()
	}
}

func (s *Supervisor) applyEvent(p *proc, ev worker.Event) {
	now := time.Now()
	switch ev.Type {
	case worker.EvOpen:
		p.rt.Peers = append(p.rt.Peers, Peer{Session: ev.Session, Device: ev.Device, Since: now.Unix()})
		p.appendLog(fmt.Sprintf("[olc-ui] peer connected: device %s", ev.Device))
	case worker.EvClose:
		for i, peer := range p.rt.Peers {
			if peer.Session == ev.Session {
				p.rt.Peers = append(p.rt.Peers[:i], p.rt.Peers[i+1:]...)
				p.appendLog(fmt.Sprintf("[olc-ui] peer disconnected: device %s (%s)", peer.Device, ev.Reason))
				break
			}
		}
	case worker.EvHealth:
		if ev.RTTms > 0 {
			p.rt.RTTms = ev.RTTms
		}
	case worker.EvStats:
		dDown, dUp := ev.Down-min(p.rt.Down, ev.Down), ev.Up-min(p.rt.Up, ev.Up)
		if el := now.Sub(p.lastStat).Seconds(); !p.lastStat.IsZero() && el > 0 {
			p.rt.RateDown, p.rt.RateUp = uint64(float64(dDown)/el), uint64(float64(dUp)/el)
		}
		p.lastStat = now
		p.rt.Down, p.rt.Up, p.rt.Conns = ev.Down, ev.Up, ev.Active
		acc := s.pending[p.loc.ClientID]
		s.pending[p.loc.ClientID] = [2]uint64{acc[0] + dDown, acc[1] + dUp}
	case worker.EvExit:
		p.rt.LastError = ev.Error
	}
}

func (s *Supervisor) readLogs(p *proc, r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		s.mu.Lock()
		p.appendLog(sc.Text())
		s.mu.Unlock()
	}
}

func (p *proc) appendLog(line string) {
	p.logs = append(p.logs, LogLine{TS: time.Now().Unix(), Line: line})
	if len(p.logs) > logLines {
		p.logs = append(p.logs[:0], p.logs[len(p.logs)-logLines:]...)
	}
}

// Runtime returns the state of a location. Rates decay to zero when the
// worker stops reporting (it only reports on change).
func (s *Supervisor) Runtime(locationID int64) Runtime {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.procs[locationID]
	if p == nil {
		reason := s.stopped[locationID]
		if reason == "" {
			reason = "pending"
		}
		return Runtime{Status: StatusStopped, Reason: reason, Peers: []Peer{}}
	}
	rt := p.rt
	rt.Peers = append([]Peer{}, p.rt.Peers...)
	sort.Slice(rt.Peers, func(i, j int) bool { return rt.Peers[i].Since < rt.Peers[j].Since })
	if time.Since(p.lastStat) > 2*worker.StatsInterval+time.Second {
		rt.RateDown, rt.RateUp = 0, 0
	}
	if rt.PID != 0 {
		rt.MemoryBytes = processRSS(rt.PID)
	}
	return rt
}

// Logs returns captured log lines for a location.
func (s *Supervisor) Logs(locationID int64) []LogLine {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p := s.procs[locationID]; p != nil {
		return append([]LogLine{}, p.logs...)
	}
	return []LogLine{}
}

// processRSS reads the resident set size from /proc (Linux only).
func processRSS(pid int) uint64 {
	raw, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "status"))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if f := strings.Fields(line); len(f) >= 2 && f[0] == "VmRSS:" {
			kb, _ := strconv.ParseUint(f[1], 10, 64)
			return kb * 1024
		}
	}
	return 0
}
