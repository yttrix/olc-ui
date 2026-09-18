package spec

import "testing"

const testKey = "d823fa01cb3e0609b67322f7cf984c4ee2e4ce2e294936fc24ef38c9e59f4799"

func TestURIRoundTrip(t *testing.T) {
	cases := []Endpoint{
		{Provider: ProviderWB, Transport: TransportVP8, Room: "room-01", Key: testKey,
			Options: map[string]string{"vp8-fps": "60", "vp8-batch": "64"}},
		{Provider: ProviderJitsi, Transport: TransportDC, Room: "https://meet.example.org/myroom", Key: testKey},
		{Provider: ProviderTelemost, Transport: TransportVideo, Room: "123456", Key: testKey,
			Options: map[string]string{"video-codec": "qrcode", "video-w": "1080"}},
	}
	for _, ep := range cases {
		ep.Normalize()
		uri := ep.URI("RU / test")
		got, comment, err := ParseURI(uri)
		if err != nil {
			t.Fatalf("ParseURI(%q): %v", uri, err)
		}
		if comment != "RU / test" {
			t.Fatalf("comment = %q", comment)
		}
		if got.URI("RU / test") != uri {
			t.Fatalf("round trip mismatch:\n%s\n%s", uri, got.URI("RU / test"))
		}
	}
}

func TestParseUpstreamExample(t *testing.T) {
	uri := "olcrtc://wbstream?seichannel<fps=60&batch=64&frag=900&ack-ms=2000>@room-01#" + testKey + "$DE / olc free sub"
	ep, comment, err := ParseURI(uri)
	if err != nil {
		t.Fatal(err)
	}
	if ep.Transport != TransportSEI || ep.Int("frag") != 900 || comment != "DE / olc free sub" {
		t.Fatalf("unexpected parse: %+v %q", ep, comment)
	}
}

func TestValidate(t *testing.T) {
	bad := []Endpoint{
		{Provider: "zoom", Transport: TransportDC, Room: "r", Key: testKey},
		{Provider: ProviderWB, Transport: TransportVP8, Room: "any", Key: testKey},
		{Provider: ProviderWB, Transport: TransportVP8, Room: "r", Key: "abc"},
		{Provider: ProviderJitsi, Transport: TransportDC, Room: "noslash", Key: testKey},
		{Provider: ProviderWB, Transport: TransportVP8, Room: "r", Key: testKey, Options: map[string]string{"fps": "1"}},
	}
	for _, ep := range bad {
		ep.Normalize()
		if ep.Validate() == nil {
			t.Fatalf("expected error for %+v", ep)
		}
	}
}

func TestRoomFromLink(t *testing.T) {
	cases := map[[2]string]string{
		{ProviderTelemost, "https://telemost.yandex.ru/j/12345678901234"}: "12345678901234",
		{ProviderTelemost, "telemost.yandex.ru/j/555/?utm=1"}:             "555",
		{ProviderTelemost, "12345"}:                                       "12345",
		{ProviderWB, "https://stream.wb.ru/room/3f2a-b9c1?from=share"}:    "3f2a-b9c1",
		{ProviderWB, "abc-123"}:                                           "abc-123",
		{ProviderJitsi, "https://meet.example.org/room"}:                  "https://meet.example.org/room",
	}
	for in, want := range cases {
		ep := Endpoint{Provider: in[0], Room: in[1]}
		ep.Normalize()
		if ep.Room != want {
			t.Errorf("%s %q -> %q, want %q", in[0], in[1], ep.Room, want)
		}
	}
}
