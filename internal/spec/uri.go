package spec

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// ErrURI is returned for malformed olcrtc:// links.
var ErrURI = errors.New("invalid olcrtc uri")

const uriScheme = "olcrtc://"

// URI renders the endpoint as
// olcrtc://<provider>?<transport><k=v&...>@<room>#<key>$<comment>.
// The format is shared with owenclave / olcbox / veil clients.
func (e Endpoint) URI(comment string) string {
	var b strings.Builder
	b.WriteString(uriScheme)
	b.WriteString(e.Provider)
	b.WriteByte('?')
	b.WriteString(e.Transport)
	if len(e.Options) > 0 {
		keys := make([]string, 0, len(e.Options))
		for k := range e.Options {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		b.WriteByte('<')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte('&')
			}
			b.WriteString(k + "=" + e.Options[k])
		}
		b.WriteByte('>')
	}
	b.WriteString("@" + e.Room + "#" + e.Key)
	if comment = strings.NewReplacer("\n", " ", "\r", " ").Replace(comment); comment != "" {
		b.WriteString("$" + comment)
	}
	return b.String()
}

// ParseURI parses an olcrtc:// link. The comment after '$' is returned
// separately; it is never part of the endpoint.
func ParseURI(raw string) (Endpoint, string, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, uriScheme) {
		return Endpoint{}, "", fmt.Errorf("%w: missing %s", ErrURI, uriScheme)
	}
	rest := raw[len(uriScheme):]
	provider, rest, ok := strings.Cut(rest, "?")
	if !ok {
		return Endpoint{}, "", fmt.Errorf("%w: missing ?transport", ErrURI)
	}
	// The room may be a Jitsi URL, so split on the first '@' after the
	// transport block and the last '#' before the comment.
	head, tail, ok := strings.Cut(rest, "@")
	if !ok {
		return Endpoint{}, "", fmt.Errorf("%w: missing @room", ErrURI)
	}
	comment := ""
	if i := strings.LastIndex(tail, "$"); i >= 0 {
		tail, comment = tail[:i], tail[i+1:]
	}
	i := strings.LastIndex(tail, "#")
	if i < 0 {
		return Endpoint{}, "", fmt.Errorf("%w: missing #key", ErrURI)
	}
	ep := Endpoint{Provider: provider, Room: tail[:i], Key: tail[i+1:], Options: map[string]string{}}
	transport, payload, hasPayload := strings.Cut(head, "<")
	ep.Transport = transport
	if hasPayload {
		payload = strings.TrimSuffix(payload, ">")
		for _, kv := range strings.Split(payload, "&") {
			if k, v, ok := strings.Cut(kv, "="); ok && k != "" {
				ep.Options[k] = v
			}
		}
	}
	// Legacy producers still emit these; the runtime ignores them.
	delete(ep.Options, "video-bitrate")
	delete(ep.Options, "video-hw")
	ep.Normalize()
	return ep, comment, ep.Validate()
}
