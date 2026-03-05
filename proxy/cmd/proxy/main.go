package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/user/minecraft-web/proxy/internal/metrics"
	"github.com/user/minecraft-web/proxy/internal/router"
	"github.com/user/minecraft-web/proxy/internal/tcp"
	"github.com/user/minecraft-web/proxy/internal/transport"
)

func main() {
	port := flag.Int("port", 25565, "TCP listen port for Minecraft clients")
	wtPort := flag.Int("wt-port", 4433, "WebTransport listen port")
	apiPort := flag.Int("api-port", 9090, "HTTP API port for metrics")
	webPort := flag.Int("web-port", 80, "HTTP port for web UI")
	domain := flag.String("domain", "localhost", "Base domain for subdomain routing")
	cert := flag.String("cert", "certs/cert.pem", "TLS certificate file")
	key := flag.String("key", "certs/key.pem", "TLS private key file")
	webDir := flag.String("web-dir", "", "Directory to serve static web files from (disables web server if empty)")
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

	// Metrics HTTP API server (proxy dashboard)
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

	// Web UI server (static files + Mojang API proxy)
	var webServer *http.Server
	if *webDir != "" {
		webServer = &http.Server{
			Addr:    fmt.Sprintf(":%d", *webPort),
			Handler: webHandler(*webDir),
		}
		go func() {
			log.Printf("web: serving %s on :%d", *webDir, *webPort)
			if err := webServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("web: %v", err)
			}
		}()
	}

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
	if webServer != nil {
		webServer.Close()
	}
	wg.Wait()
	log.Println("proxy stopped")
}

// webHandler builds an HTTP handler that serves static files with SPA fallback,
// proxies /api/mojang/ to Mojang's session server, and adds gzip-friendly headers.
func webHandler(dir string) http.Handler {
	absDir, err := filepath.Abs(dir)
	if err != nil {
		log.Fatalf("web: invalid directory %q: %v", dir, err)
	}

	mux := http.NewServeMux()

	// Mojang session server reverse proxy
	mojangTarget, _ := url.Parse("https://sessionserver.mojang.com")
	mojangProxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = mojangTarget.Scheme
			req.URL.Host = mojangTarget.Host
			req.Host = mojangTarget.Host
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api/mojang")
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
			req.Header.Set("Accept", "application/json")
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{},
		},
	}
	mux.Handle("/api/mojang/", mojangProxy)

	// Proxy stats API (same endpoint as metrics server, available on web port too)
	mux.HandleFunc("/api/proxy/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(metrics.Get().Snapshot())
	})

	// Static files with SPA fallback
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the exact file
		path := filepath.Join(absDir, filepath.Clean(r.URL.Path))

		// Prevent directory traversal
		if !strings.HasPrefix(path, absDir) {
			http.NotFound(w, r)
			return
		}

		info, err := os.Stat(path)
		if err == nil && !info.IsDir() {
			setCacheHeaders(w, r.URL.Path)
			http.ServeFile(w, r, path)
			return
		}

		// SPA fallback: serve index.html for non-file routes
		indexPath := filepath.Join(absDir, "index.html")
		f, err := os.Open(indexPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.Copy(w, f)
	})

	return mux
}

// setCacheHeaders sets Cache-Control for static assets.
func setCacheHeaders(w http.ResponseWriter, path string) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".js", ".css", ".wasm", ".png", ".jpg", ".ico", ".svg":
		w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	}
}
