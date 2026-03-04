package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"net/http"

	"github.com/user/minecraft-web/proxy/internal/metrics"
	"github.com/user/minecraft-web/proxy/internal/router"
	"github.com/user/minecraft-web/proxy/internal/tcp"
	"github.com/user/minecraft-web/proxy/internal/transport"
)

func main() {
	port := flag.Int("port", 25565, "TCP listen port for Minecraft clients")
	wtPort := flag.Int("wt-port", 4433, "WebTransport listen port")
	apiPort := flag.Int("api-port", 9090, "HTTP API port for metrics")
	domain := flag.String("domain", "localhost", "Base domain for subdomain routing")
	cert := flag.String("cert", "certs/cert.pem", "TLS certificate file")
	key := flag.String("key", "certs/key.pem", "TLS private key file")
	flag.Parse()

	log.Printf("proxy starting... tcp=%d wt=%d domain=%s", *port, *wtPort, *domain)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Shared router for subdomain → session mapping
	r := router.New()

	// WebTransport server (required — fatal if it fails)
	wts := &transport.Server{
		Addr:    fmt.Sprintf(":%d", *wtPort),
		TLSCert: *cert,
		TLSKey:  *key,
		Router:  r,
	}

	// TCP listener for Minecraft clients (non-fatal — log and continue)
	tcpListener := &tcp.Listener{
		Addr:   fmt.Sprintf(":%d", *port),
		Domain: *domain,
		Router: r,
	}

	// Metrics HTTP API server
	apiServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", *apiPort),
		Handler: metrics.Handler(),
	}
	go func() {
		log.Printf("api: listening on %s", apiServer.Addr)
		if err := apiServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("api: %v", err)
		}
	}()

	var wg sync.WaitGroup

	// WebTransport is the critical service
	wtErrCh := make(chan error, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		wtErrCh <- wts.ListenAndServe(ctx)
	}()

	// TCP listener is best-effort — port may be in use
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := tcpListener.ListenAndServe(ctx); err != nil && ctx.Err() == nil {
			log.Printf("tcp: %v (Minecraft clients won't be able to connect on this port)", err)
		}
	}()

	// Wait for interrupt or WT fatal error
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	select {
	case s := <-sig:
		log.Printf("received %v, shutting down", s)
	case err := <-wtErrCh:
		log.Printf("fatal: WebTransport server failed: %v", err)
	}

	cancel()
	apiServer.Close()
	wg.Wait()
	log.Println("proxy stopped")
}
