package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/yttrix/olc-ui/core/pkg/olcrtc/client"
	"github.com/yttrix/olc-ui/internal/spec"
)

func clientMain(args []string) int {
	fs := flag.NewFlagSet("client", flag.ExitOnError)
	listen := fs.String("listen", "127.0.0.1:8808", "local SOCKS5 address")
	_ = fs.Parse(args)
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: olc-ui client [-listen 127.0.0.1:8808] 'olcrtc://...'")
		return 2
	}
	ep, comment, err := spec.ParseURI(fs.Arg(0))
	if err != nil {
		log.Printf("%v", err)
		return 1
	}
	log.Printf("connecting: %s / %s %s", ep.Provider, ep.Transport, comment)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err = client.New(ep.ClientConfig(*listen)).RunWithAddress(ctx, func(addr string) {
		log.Printf("ready: socks5://%s  (try: curl --socks5-hostname %s https://icanhazip.com)", addr, addr)
	})
	if err != nil && ctx.Err() == nil {
		log.Printf("client: %v", err)
		return 1
	}
	return 0
}
