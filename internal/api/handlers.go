package api

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/yttrix/olc-ui/internal/spec"
	"github.com/yttrix/olc-ui/internal/store"
	"github.com/yttrix/olc-ui/internal/supervisor"
)

// JitsiInstances are public Jitsi Meet hosts known to allow guests. Hosts come
// and go; the admin should verify one opens from the client network.
var JitsiInstances = []string{ //nolint:gochecknoglobals // static table
	"meet.egovm.ru", "conference.ct.placetime.team", "jitsy.amateusfox.online", "meet.mamba.group",
	"meet.ecopsy.com", "meet.mirox.chat", "webinar.knomary.dev", "meet.playform.ru",
	"zgn-y-vc01.zignotch.com", "conf.expressmoney.com", "m.catonmoon.com", "conf.hyperia.space",
	"jitsi.etudevs.ru", "meet.riddlerx.org", "meet.handyweb.org",
}

var refreshRe = regexp.MustCompile(`^[0-9]+[smhd]$`)

type locationView struct {
	store.Location
	URI     string             `json:"uri"`
	Runtime supervisor.Runtime `json:"runtime"`
}

type clientView struct {
	store.Client
	Status    string         `json:"status"`
	SubURL    string         `json:"sub_url"`
	Devices   int            `json:"devices"`
	Locations []locationView `json:"locations"`
}

func (s *Server) view(r *http.Request, c store.Client, now time.Time) clientView {
	v := clientView{Client: c, Status: c.Status(now), SubURL: s.subURL(r, c.SubToken), Locations: []locationView{}}
	for _, l := range c.Locations {
		v.Locations = append(v.Locations, locationView{
			Location: l, URI: l.Endpoint.URI(s.comment(l)), Runtime: s.sup.Runtime(l.ID),
		})
	}
	return v
}

func (s *Server) comment(l store.Location) string {
	if l.Name == "" {
		return s.panelName()
	}
	return s.panelName() + " / " + l.Name
}

func (s *Server) subURL(r *http.Request, token string) string {
	host := s.store.Setting(KeyPublicHost)
	scheme := "https"
	if host == "" {
		host = r.Host
		if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
			scheme = "http"
		}
	} else if strings.Contains(host, "://") {
		return strings.TrimRight(host, "/") + "/sub/" + token
	}
	return scheme + "://" + host + "/sub/" + token
}

func (s *Server) handleMeta(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{
		"providers":             spec.Providers,
		"transports":            spec.Transports,
		"matrix":                spec.Matrix,
		"recommended_transport": spec.RecommendedTransport,
		"option_keys":           spec.OptionKeys,
		"jitsi_instances":       JitsiInstances,
		"default_dns":           spec.DefaultDNS,
	})
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	clients, err := s.store.Clients()
	if err != nil {
		storeErr(w, err)
		return
	}
	now := time.Now()
	y, m, d := now.Date()
	dayStart := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).Unix()
	weekStart := dayStart - 6*86400
	stats := map[string]int64{}
	for _, c := range clients {
		stats["clients"]++
		stats["status_"+c.Status(now)]++
		switch {
		case c.LastOnline == 0:
			stats["never_online"]++
		case c.LastOnline >= dayStart:
			stats["online_today"]++
			stats["online_week"]++
		case c.LastOnline >= weekStart:
			stats["online_week"]++
		}
		for _, l := range c.Locations {
			stats["locations"]++
			rt := s.sup.Runtime(l.ID)
			if rt.Status == supervisor.StatusRunning {
				stats["running"]++
			}
			stats["peers"] += int64(len(rt.Peers))
			stats["rate_down"] += int64(rt.RateDown)
			stats["rate_up"] += int64(rt.RateUp)
			stats["workers_mem"] += int64(rt.MemoryBytes)
		}
	}
	traffic, err := s.store.Traffic(0, 60, now)
	if err != nil {
		storeErr(w, err)
		return
	}
	sum := func(from, to int) int64 { // days back, [from,to)
		var t int64
		for i := len(traffic) - to; i < len(traffic)-from; i++ {
			t += traffic[i].Down + traffic[i].Up
		}
		return t
	}
	totals := map[string]int64{
		"today": sum(0, 1), "yesterday": sum(1, 2),
		"week": sum(0, 7), "prev_week": sum(7, 14),
		"month": sum(0, 30), "prev_month": sum(30, 60),
	}
	writeJSON(w, map[string]any{
		"name": s.panelName(), "version": s.version, "uptime": int64(time.Since(s.started).Seconds()),
		"stats": stats, "totals": totals, "traffic": traffic[30:], "memory": memStats(),
	})
}

func (s *Server) handleClients(w http.ResponseWriter, r *http.Request) {
	clients, err := s.store.Clients()
	if err != nil {
		storeErr(w, err)
		return
	}
	devices, _ := s.store.DeviceCounts()
	now := time.Now()
	out := make([]clientView, 0, len(clients))
	for _, c := range clients {
		v := s.view(r, c, now)
		v.Devices = devices[c.ID]
		out = append(out, v)
	}
	writeJSON(w, out)
}

func (s *Server) handleClient(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	c, err := s.store.Client(id)
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, s.view(r, c, time.Now()))
}

type clientInput struct {
	MaxConns     int             `json:"max_conns"`
	MaxDevices   int             `json:"max_devices"`
	Name         string          `json:"name"`
	Note         string          `json:"note"`
	Enabled      bool            `json:"enabled"`
	SpeedMbps    int             `json:"speed_mbps"`
	TrafficLimit int64           `json:"traffic_limit"`
	ExpiresAt    string          `json:"expires_at"`
	Refresh      string          `json:"refresh"`
	Locations    []locationInput `json:"locations,omitempty"`
}

func (in clientInput) apply(c *store.Client) error {
	c.Name = strings.TrimSpace(in.Name)
	c.Note = strings.TrimSpace(in.Note)
	c.Enabled, c.SpeedMbps, c.TrafficLimit = in.Enabled, in.SpeedMbps, in.TrafficLimit
	c.MaxConns, c.MaxDevices = in.MaxConns, in.MaxDevices
	c.ExpiresAt, c.Refresh = strings.TrimSpace(in.ExpiresAt), strings.TrimSpace(in.Refresh)
	switch {
	case c.Name == "" || len(c.Name) > 64 || strings.ContainsAny(c.Name, "\r\n"):
		return fmt.Errorf("name is required (up to 64 characters)")
	case c.SpeedMbps < 0 || c.TrafficLimit < 0 || c.MaxConns < 0 || c.MaxDevices < 0:
		return fmt.Errorf("limits must not be negative")
	case c.Refresh != "" && !refreshRe.MatchString(c.Refresh):
		return fmt.Errorf("refresh must look like 30m, 6h or 1d")
	}
	if c.ExpiresAt != "" {
		if _, err := time.Parse(time.DateOnly, c.ExpiresAt); err != nil {
			return fmt.Errorf("expires_at must be YYYY-MM-DD")
		}
	}
	return nil
}

func (s *Server) handleCreateClient(w http.ResponseWriter, r *http.Request) {
	var in clientInput
	if !readJSON(w, r, &in) {
		return
	}
	var c store.Client
	if err := in.apply(&c); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	locs := make([]store.Location, 0, len(in.Locations))
	for _, li := range in.Locations {
		var l store.Location
		if err := s.applyLocation(li, &l); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		locs = append(locs, l)
	}
	if err := s.store.SaveClient(&c); err != nil {
		storeErr(w, err)
		return
	}
	for i := range locs {
		locs[i].ClientID = c.ID
		if err := s.store.SaveLocation(&locs[i]); err != nil {
			storeErr(w, err)
			return
		}
	}
	s.store.Audit("client_created", c.Name)
	s.sup.Kick()
	c, _ = s.store.Client(c.ID)
	writeJSON(w, s.view(r, c, time.Now()))
}

func (s *Server) handleUpdateClient(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in clientInput
	if !readJSON(w, r, &in) {
		return
	}
	c, err := s.store.Client(id)
	if err != nil {
		storeErr(w, err)
		return
	}
	if err := in.apply(&c); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SaveClient(&c); err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("client_updated", c.Name)
	s.sup.Kick()
	writeJSON(w, s.view(r, c, time.Now()))
}

func (s *Server) handleDeleteClient(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	c, err := s.store.Client(id)
	if err == nil {
		err = s.store.DeleteClient(id)
	}
	if err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("client_deleted", c.Name)
	s.sup.Kick()
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleResetUsage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.ResetUsage(id); err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("usage_reset", strconv.FormatInt(id, 10))
	s.sup.Kick()
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleRotateSub(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	tok, err := s.store.RotateSubToken(id)
	if err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("sub_rotated", strconv.FormatInt(id, 10))
	writeJSON(w, map[string]any{"sub_url": s.subURL(r, tok)})
}

func (s *Server) handleClientTraffic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 || days > 365 {
		days = 30
	}
	tr, err := s.store.Traffic(id, days, time.Now())
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, tr)
}

type locationInput struct {
	Name     string        `json:"name"`
	Enabled  bool          `json:"enabled"`
	Endpoint spec.Endpoint `json:"endpoint"`
}

// applyLocation validates input and fills generated fields: a fresh key when
// empty and, for Jitsi, a random room on the chosen (or default) instance.
func (s *Server) applyLocation(in locationInput, l *store.Location) error {
	l.Name = strings.TrimSpace(in.Name)
	l.Enabled = in.Enabled
	ep := in.Endpoint
	ep.Normalize()
	if ep.Key == "" {
		ep.Key = spec.NewKey()
	}
	if ep.Provider == spec.ProviderJitsi && !strings.Contains(strings.TrimPrefix(ep.Room, "https://"), "/") {
		instance := ep.Room
		if instance == "" {
			instance = s.jitsiInstance()
		}
		ep.Room = spec.NewJitsiRoom(instance)
	}
	if err := ep.Validate(); err != nil {
		return err //nolint:wrapcheck // user-facing validation message
	}
	if other, used := s.store.RoomInUse(ep.Provider, ep.Room, l.ID); used {
		return fmt.Errorf("this room is already used by location %q: one room can serve only one location", other)
	}
	l.Endpoint = ep
	return nil
}

func (s *Server) jitsiInstance() string {
	if v := s.store.Setting(KeyJitsi); v != "" {
		return v
	}
	return JitsiInstances[0]
}

func (s *Server) handleCreateLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in locationInput
	if !readJSON(w, r, &in) {
		return
	}
	if _, err := s.store.Client(id); err != nil {
		storeErr(w, err)
		return
	}
	l := store.Location{ClientID: id}
	if err := s.applyLocation(in, &l); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SaveLocation(&l); err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("location_created", fmt.Sprintf("%d %s/%s", l.ID, l.Endpoint.Provider, l.Endpoint.Transport))
	s.sup.Kick()
	writeJSON(w, l)
}

func (s *Server) handleUpdateLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in locationInput
	if !readJSON(w, r, &in) {
		return
	}
	l, err := s.store.Location(id)
	if err != nil {
		storeErr(w, err)
		return
	}
	if err := s.applyLocation(in, &l); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SaveLocation(&l); err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("location_updated", strconv.FormatInt(id, 10))
	s.sup.Kick()
	writeJSON(w, l)
}

func (s *Server) handleDeleteLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteLocation(id); err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("location_deleted", strconv.FormatInt(id, 10))
	s.sup.Kick()
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleRestartLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	s.sup.Restart(id)
	s.store.Audit("location_restarted", strconv.FormatInt(id, 10))
	writeJSON(w, map[string]any{"ok": true})
}

// mutateLocation loads a location, applies fn and saves it.
func (s *Server) mutateLocation(w http.ResponseWriter, r *http.Request, action string, fn func(*store.Location) error) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	l, err := s.store.Location(id)
	if err != nil {
		storeErr(w, err)
		return
	}
	if err := fn(&l); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SaveLocation(&l); err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit(action, strconv.FormatInt(id, 10))
	s.sup.Kick()
	writeJSON(w, l)
}

func (s *Server) handleRotateKey(w http.ResponseWriter, r *http.Request) {
	s.mutateLocation(w, r, "key_rotated", func(l *store.Location) error {
		l.Endpoint.Key = spec.NewKey()
		return nil
	})
}

func (s *Server) handleNewRoom(w http.ResponseWriter, r *http.Request) {
	s.mutateLocation(w, r, "room_regenerated", func(l *store.Location) error {
		if l.Endpoint.Provider != spec.ProviderJitsi {
			return fmt.Errorf("rooms for %s are created on the provider website; paste the new room id instead", l.Endpoint.Provider)
		}
		host := strings.TrimPrefix(strings.TrimPrefix(l.Endpoint.Room, "https://"), "http://")
		host, _, _ = strings.Cut(host, "/")
		l.Endpoint.Room = spec.NewJitsiRoom(host)
		return nil
	})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	writeJSON(w, s.sup.Logs(id))
}

func (s *Server) handleAudit(w http.ResponseWriter, _ *http.Request) {
	entries, err := s.store.AuditLog(200)
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, entries)
}

type settingsView struct {
	PanelName  string `json:"panel_name"`
	PublicHost string `json:"public_host"`
	Refresh    string `json:"sub_refresh"`
	Jitsi      string `json:"jitsi_instance"`
}

func (s *Server) handleGetSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{
		"panel_name": s.panelName(), "public_host": s.store.Setting(KeyPublicHost),
		"sub_refresh": s.refresh(), "jitsi_instance": s.jitsiInstance(),
		"base_path": s.base, "version": s.version, "user": s.store.Setting(keyAdminUser),
	})
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var in settingsView
	if !readJSON(w, r, &in) {
		return
	}
	in.Refresh = strings.TrimSpace(in.Refresh)
	if in.Refresh != "" && !refreshRe.MatchString(in.Refresh) {
		writeErr(w, http.StatusBadRequest, "refresh must look like 30m, 6h or 1d")
		return
	}
	for k, v := range map[string]string{
		KeyPanelName: in.PanelName, KeyPublicHost: in.PublicHost, KeyRefresh: in.Refresh, KeyJitsi: in.Jitsi,
	} {
		if err := s.store.SetSetting(k, strings.TrimSpace(v)); err != nil {
			storeErr(w, err)
			return
		}
	}
	s.store.Audit("settings_updated", "")
	s.handleGetSettings(w, r)
}
