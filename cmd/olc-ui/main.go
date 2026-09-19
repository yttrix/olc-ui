// Command olc-ui is a web panel for olcrtc-style tunnels over video-call
// services (WB Stream, Yandex Telemost, Jitsi).
//
//	olc-ui [panel] [flags]          run the web panel (default)
//	olc-ui worker <config.json>     run one tunnel server (spawned by the panel)
//	olc-ui client <olcrtc://...>    run a local SOCKS5 client for testing
//	olc-ui admin [-user u] [-pass p]  set admin credentials, print panel path
//	olc-ui info                     print the panel path
//	olc-ui cert                     issue a Let's Encrypt certificate now
//	olc-ui backup [-o file]         write a database backup
//	olc-ui restore <file>           restore clients from a backup
//	olc-ui version
package main

import (
	"fmt"
	"os"

	"github.com/yttrix/olc-ui/internal/worker"
)

// Set at build time via -ldflags "-X main.version=...".
var version = "dev" //nolint:gochecknoglobals // build metadata

func main() {
	args := os.Args[1:]
	cmd := "panel"
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "worker":
		os.Exit(worker.Main(args))
	case "client":
		os.Exit(clientMain(args))
	case "cert":
		os.Exit(certMain(args))
	case "backup":
		os.Exit(backupMain(args))
	case "restore":
		os.Exit(restoreMain(args))
	case "info":
		os.Exit(infoMain(args))
	case "admin":
		os.Exit(adminMain(args))
	case "panel":
		os.Exit(panelMain(args))
	case "version", "-v", "--version":
		fmt.Println("olc-ui", version)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", cmd)
		os.Exit(2)
	}
}
