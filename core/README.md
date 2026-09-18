# core

Fork of [openlibrecommunity/olcrtc](https://github.com/openlibrecommunity/olcrtc) (WTFPL, see LICENSE),
taken at commit `92b2332` (2026-09). Upstream announced it is being folded into another project and no
longer accepts changes, so the tunnel core is vendored here.

Changes against upstream:

- import paths rewritten to `github.com/yttrix/olc-ui/core/...`;
- `server.Config.WrapEgress` / `tunnel.Config.WrapEgress`: wraps every outbound target connection
  (live traffic metering and rate limiting in olc-ui);
- dropped the test that validated upstream `docs/examples`.

Keep changes here minimal and listed above so upstream fixes can be merged by hand.
