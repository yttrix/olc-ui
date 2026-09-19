package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/yttrix/olc-ui/internal/store"
)

// handleSubscription renders the olcrtc subscription format (docs/sub.md of
// upstream olcrtc) consumed by owenclave / olcbox. Unknown tokens get a bare
// 404 so the endpoint does not reveal the panel.
func (s *Server) handleSubscription(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.ClientBySubToken(r.PathValue("token"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// olcbox identifies each installation with x-hwid (like Happ/Incy).
	// With a device limit, requests without it (browsers, copied links) and
	// new devices over the limit are refused.
	hwid := r.Header.Get("x-hwid")
	switch {
	case hwid != "":
		err := s.store.TouchDevice(c.ID, hwid, r.UserAgent(), clientIP(r), c.MaxDevices)
		switch {
		case errors.Is(err, store.ErrDeviceLimit):
			http.Error(w, fmt.Sprintf("Device limit reached (%d). Ask the administrator to free a slot.", c.MaxDevices), http.StatusForbidden)
			return
		case errors.Is(err, store.ErrDeviceBlocked):
			http.Error(w, "This device is blocked.", http.StatusForbidden)
			return
		}
	case c.MaxDevices > 0:
		http.Error(w, "This subscription is limited to registered devices: add it in the olcbox app.", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(s.renderSubscription(c, time.Now())))
}

func (s *Server) renderSubscription(c store.Client, now time.Time) string {
	var b strings.Builder
	line := func(format string, args ...any) { fmt.Fprintf(&b, format+"\n", args...) }
	refresh := c.Refresh
	if refresh == "" {
		refresh = s.refresh()
	}
	status := c.Status(now)
	line("#name: %s", oneLine(s.panelName()+" / "+c.Name))
	line("#update: %d", now.Unix())
	line("#refresh: %s", refresh)
	if c.TrafficLimit > 0 {
		line("#used: %s/%s", human(c.UsedBytes), human(c.TrafficLimit))
		line("#available: %s", human(max(c.TrafficLimit-c.UsedBytes, 0)))
	} else {
		line("#used: %s", human(c.UsedBytes))
	}
	if c.ExpiresAt != "" {
		line("#expires: %s", c.ExpiresAt)
	}
	line("#status: %s", status)
	if status != store.StatusActive {
		return b.String()
	}
	for _, l := range c.Locations {
		if !l.Enabled {
			continue
		}
		b.WriteString("\n")
		line("%s", l.Endpoint.URI(s.comment(l)))
		if l.Name != "" {
			line("##name: %s", oneLine(l.Name))
		}
		line("##comment: %s + %s", l.Endpoint.Provider, l.Endpoint.Transport)
	}
	return b.String()
}

func oneLine(s string) string { return strings.NewReplacer("\n", " ", "\r", " ").Replace(s) }

// human formats bytes in the lowercase units the sub format expects.
func human(n int64) string {
	units := []string{"b", "kb", "mb", "gb", "tb"}
	f := float64(n)
	i := 0
	for f >= 1024 && i < len(units)-1 {
		f /= 1024
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%d%s", n, units[0])
	}
	return strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.2f", f), "0"), ".0") + units[i]
}
