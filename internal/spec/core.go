package spec

import (
	"github.com/yttrix/olc-ui/core/pkg/olcrtc/client"
	"github.com/yttrix/olc-ui/core/pkg/olcrtc/tunnel"
)

// TunnelConfig converts the endpoint into a core server config. Hooks are
// left for the caller to fill in.
func (e Endpoint) TunnelConfig() tunnel.Config {
	cfg := tunnel.Config{
		Transport:     e.Transport,
		Provider:      e.Provider,
		RoomURL:       e.Room,
		ProviderToken: e.ProviderToken,
		KeyHex:        e.Key,
		DNSServer:     e.DNS,
	}
	if p := e.Proxy; p != nil {
		cfg.SOCKSProxyAddr, cfg.SOCKSProxyPort = p.Addr, p.Port
		cfg.SOCKSProxyUser, cfg.SOCKSProxyPass = p.User, p.Pass
	}
	switch e.Transport {
	case TransportVP8:
		cfg.TransportOptions = tunnel.VP8Options(e.vp8())
	case TransportSEI:
		cfg.TransportOptions = tunnel.SEIOptions(e.sei())
	case TransportVideo:
		cfg.TransportOptions = tunnel.VideoOptions(e.video())
	}
	return cfg
}

// ClientConfig converts the endpoint into a core SOCKS5 client config.
func (e Endpoint) ClientConfig(listen string) client.Config {
	cfg := client.Config{
		Transport:     e.Transport,
		Provider:      e.Provider,
		RoomURL:       e.Room,
		ProviderToken: e.ProviderToken,
		KeyHex:        e.Key,
		DNSServer:     e.DNS,
		LocalAddr:     listen,
	}
	switch e.Transport {
	case TransportVP8:
		cfg.TransportOptions = client.VP8Options(e.vp8())
	case TransportSEI:
		cfg.TransportOptions = client.SEIOptions(e.sei())
	case TransportVideo:
		cfg.TransportOptions = client.VideoOptions(e.video())
	}
	return cfg
}

type vp8 struct{ FPS, BatchSize int }

func (e Endpoint) vp8() vp8 { return vp8{FPS: e.Int("vp8-fps"), BatchSize: e.Int("vp8-batch")} }

type sei struct{ FPS, BatchSize, FragmentSize, AckTimeoutMS int }

func (e Endpoint) sei() sei {
	return sei{FPS: e.Int("fps"), BatchSize: e.Int("batch"), FragmentSize: e.Int("frag"), AckTimeoutMS: e.Int("ack-ms")}
}

type video struct {
	Width, Height, FPS, QRSize int
	QRRecovery, Codec          string
	TileModule, TileRS         int
}

func (e Endpoint) video() video {
	return video{
		Width: e.Int("video-w"), Height: e.Int("video-h"), FPS: e.Int("video-fps"),
		QRSize: e.Int("video-qr-size"), QRRecovery: e.Options["video-qr-recovery"],
		Codec: e.Options["video-codec"], TileModule: e.Int("video-tile-module"),
		TileRS: e.Int("video-tile-rs"),
	}
}
