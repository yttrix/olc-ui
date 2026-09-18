// Package spec describes a tunnel endpoint (provider + transport + room + key)
// and everything derived from it: validation, the compatibility matrix and
// the olcrtc:// URI format shared with third-party clients.
package spec

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"slices"
	"strconv"
	"strings"
)

// Providers and transports supported by the core.
const (
	ProviderJitsi    = "jitsi"
	ProviderTelemost = "telemost"
	ProviderWB       = "wbstream"

	TransportDC    = "datachannel"
	TransportVP8   = "vp8channel"
	TransportSEI   = "seichannel"
	TransportVideo = "videochannel"

	DefaultDNS = "8.8.8.8:53"
)

// Providers lists provider names in UI order.
var Providers = []string{ProviderWB, ProviderTelemost, ProviderJitsi} //nolint:gochecknoglobals // static table

// Transports lists transport names in speed order.
var Transports = []string{TransportDC, TransportVP8, TransportSEI, TransportVideo} //nolint:gochecknoglobals // static table

// Support describes how well a provider/transport pair works.
type Support string

// Support levels, mirroring the upstream E2E matrix.
const (
	Works    Support = "works"
	Unstable Support = "unstable"
	Broken   Support = "broken"
)

// Matrix is the provider -> transport compatibility table.
var Matrix = map[string]map[string]Support{ //nolint:gochecknoglobals // static table
	ProviderTelemost: {TransportDC: Broken, TransportVP8: Works, TransportSEI: Broken, TransportVideo: Works},
	ProviderWB:       {TransportDC: Unstable, TransportVP8: Works, TransportSEI: Works, TransportVideo: Works},
	ProviderJitsi:    {TransportDC: Works, TransportVP8: Works, TransportSEI: Works, TransportVideo: Works},
}

// RecommendedTransport is the default transport per provider.
var RecommendedTransport = map[string]string{ //nolint:gochecknoglobals // static table
	ProviderTelemost: TransportVP8,
	ProviderWB:       TransportVP8,
	ProviderJitsi:    TransportDC,
}

// OptionKeys lists allowed option keys per transport. Names match the
// olcrtc:// URI payload so options round-trip through links unchanged.
var OptionKeys = map[string][]string{ //nolint:gochecknoglobals // static table
	TransportDC:  {},
	TransportVP8: {"vp8-fps", "vp8-batch"},
	TransportSEI: {"fps", "batch", "frag", "ack-ms"},
	TransportVideo: {
		"video-w", "video-h", "video-fps", "video-codec", "video-qr-size",
		"video-qr-recovery", "video-tile-module", "video-tile-rs",
	},
}

// Errors returned by Validate.
var (
	ErrProvider  = errors.New("unknown provider")
	ErrTransport = errors.New("unknown transport")
	ErrRoom      = errors.New("room is required")
	ErrKey       = errors.New("key must be 64 hex characters")
	ErrDNS       = errors.New("dns must be host:port")
	ErrOption    = errors.New("invalid transport option")
	ErrProxy     = errors.New("invalid proxy")
)

// Proxy is an optional upstream SOCKS5 proxy for server egress.
type Proxy struct {
	Addr string `json:"addr"`
	Port int    `json:"port"`
	User string `json:"user,omitempty"`
	Pass string `json:"pass,omitempty"`
}

// Endpoint is one tunnel: both sides must share every field except Proxy.
type Endpoint struct {
	Provider      string            `json:"provider"`
	Transport     string            `json:"transport"`
	Room          string            `json:"room"`
	Key           string            `json:"key"`
	DNS           string            `json:"dns,omitempty"`
	ProviderToken string            `json:"provider_token,omitempty"`
	Options       map[string]string `json:"options,omitempty"`
	Proxy         *Proxy            `json:"proxy,omitempty"`
}

// NewKey returns a random 32-byte key as 64 hex characters.
func NewKey() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// NewJitsiRoom returns a random room URL on the given Jitsi instance.
func NewJitsiRoom(instance string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	instance = strings.TrimRight(strings.TrimSpace(instance), "/")
	if !strings.Contains(instance, "://") {
		instance = "https://" + instance
	}
	return instance + "/" + hex.EncodeToString(b[:])
}

// Normalize trims fields and drops empty options.
func (e *Endpoint) Normalize() {
	e.Provider = strings.ToLower(strings.TrimSpace(e.Provider))
	e.Transport = strings.ToLower(strings.TrimSpace(e.Transport))
	e.Room = strings.TrimSpace(e.Room)
	e.Key = strings.ToLower(strings.TrimSpace(e.Key))
	e.DNS = strings.TrimSpace(e.DNS)
	if e.DNS == "" {
		e.DNS = DefaultDNS
	}
	e.ProviderToken = strings.TrimSpace(e.ProviderToken)
	for k, v := range e.Options {
		if v = strings.TrimSpace(v); v == "" {
			delete(e.Options, k)
		} else {
			e.Options[k] = v
		}
	}
	if e.Proxy != nil && strings.TrimSpace(e.Proxy.Addr) == "" {
		e.Proxy = nil
	}
}

// Validate checks the endpoint is complete and self-consistent.
func (e Endpoint) Validate() error {
	if _, ok := Matrix[e.Provider]; !ok {
		return fmt.Errorf("%w: %q", ErrProvider, e.Provider)
	}
	allowed, ok := OptionKeys[e.Transport]
	if !ok {
		return fmt.Errorf("%w: %q", ErrTransport, e.Transport)
	}
	if e.Room == "" || e.Room == "any" {
		return ErrRoom
	}
	if strings.ContainsAny(e.Room, "#$@ ") && e.Provider != ProviderJitsi {
		return fmt.Errorf("%w: room must not contain spaces or #$@", ErrRoom)
	}
	if e.Provider == ProviderJitsi && !strings.Contains(strings.TrimPrefix(strings.TrimPrefix(e.Room, "https://"), "http://"), "/") {
		return fmt.Errorf("%w: jitsi room must be https://host/room", ErrRoom)
	}
	if b, err := hex.DecodeString(e.Key); err != nil || len(b) != 32 {
		return ErrKey
	}
	if _, port, err := net.SplitHostPort(e.DNS); err != nil || port == "" {
		return fmt.Errorf("%w: %q", ErrDNS, e.DNS)
	}
	for k, v := range e.Options {
		if !slices.Contains(allowed, k) {
			return fmt.Errorf("%w: %q not allowed for %s", ErrOption, k, e.Transport)
		}
		if err := validateOption(k, v); err != nil {
			return err
		}
	}
	if p := e.Proxy; p != nil && (p.Port <= 0 || p.Port > 65535) {
		return fmt.Errorf("%w: port %d", ErrProxy, p.Port)
	}
	return nil
}

func validateOption(k, v string) error {
	switch k {
	case "video-codec":
		if v != "qrcode" && v != "tile" {
			return fmt.Errorf("%w: video-codec must be qrcode or tile", ErrOption)
		}
		return nil
	case "video-qr-recovery":
		if !slices.Contains([]string{"low", "medium", "high", "highest"}, v) {
			return fmt.Errorf("%w: video-qr-recovery must be low/medium/high/highest", ErrOption)
		}
		return nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return fmt.Errorf("%w: %s must be a non-negative integer", ErrOption, k)
	}
	return nil
}

// Int returns an integer option or 0 when unset.
func (e Endpoint) Int(key string) int {
	n, _ := strconv.Atoi(e.Options[key])
	return n
}
