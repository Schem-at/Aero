package transport

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"

	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"

	"github.com/user/minecraft-web/proxy/internal/metrics"
	"github.com/user/minecraft-web/proxy/internal/router"
)

var adjectives = []string{
	"brave", "calm", "dark", "eager", "fast",
	"grand", "happy", "keen", "lucky", "neat",
	"proud", "quick", "red", "sharp", "tall", "warm",
}

var nouns = []string{
	"fox", "bear", "wolf", "hawk", "lynx",
	"pine", "oak", "reef", "peak", "vale",
	"star", "moon", "bolt", "gale", "dusk", "fern",
}

func generateName() string {
	return adjectives[rand.Intn(len(adjectives))] + "-" + nouns[rand.Intn(len(nouns))]
}

func randomSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 3)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// Server handles incoming WebTransport connections from browser hosts.
type Server struct {
	Addr      string
	TLSCert   string
	TLSKey    string
	Router    *router.Router
	wtServer  *webtransport.Server
}

// registration is the JSON sent by the browser on the control stream.
type registration struct {
	Room string `json:"room"`
}

// ListenAndServe starts the WebTransport server.
func (s *Server) ListenAndServe(ctx context.Context) error {
	cert, err := tls.LoadX509KeyPair(s.TLSCert, s.TLSKey)
	if err != nil {
		return fmt.Errorf("load TLS cert: %w", err)
	}

	mux := http.NewServeMux()

	h3 := &http3.Server{
		Addr:      s.Addr,
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			NextProtos:   []string{"h3"},
		},
		Handler:   mux,
	}

	// Required: advertise WebTransport support and enable datagrams in HTTP/3 settings
	webtransport.ConfigureHTTP3Server(h3)

	s.wtServer = &webtransport.Server{
		H3:          h3,
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	mux.HandleFunc("/connect", func(w http.ResponseWriter, r *http.Request) {
		session, err := s.wtServer.Upgrade(w, r)
		if err != nil {
			log.Printf("wt: upgrade failed: %v", err)
			return
		}
		go s.handleSession(ctx, session)
	})

	log.Printf("wt: listening on %s", s.Addr)

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.wtServer.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		s.wtServer.Close()
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

func (s *Server) handleSession(ctx context.Context, session *webtransport.Session) {
	defer session.CloseWithError(0, "session ended")

	// Read registration from the first bidirectional stream (control stream)
	stream, err := session.AcceptStream(ctx)
	if err != nil {
		log.Printf("wt: accept control stream failed: %v", err)
		return
	}

	var reg registration
	decoder := json.NewDecoder(stream)
	if err := decoder.Decode(&reg); err != nil {
		log.Printf("wt: read registration failed: %v", err)
		stream.Close()
		return
	}

	preferred := reg.Room
	if preferred == "" {
		preferred = generateName()
	}

	// Try to register with the preferred name, then with suffixes
	sess := &router.Session{WT: session}
	assigned := preferred
	if !s.Router.TryRegister(assigned, sess) {
		registered := false
		for i := 0; i < 5; i++ {
			assigned = preferred + "-" + randomSuffix()
			if s.Router.TryRegister(assigned, sess) {
				registered = true
				break
			}
		}
		if !registered {
			assigned = generateName() + "-" + randomSuffix()
			s.Router.Register(assigned, sess)
		}
	}

	log.Printf("wt: session registered for room %q (requested %q)", assigned, preferred)
	metrics.Get().RoomRegistered(assigned)
	defer func() {
		s.Router.Remove(assigned)
		metrics.Get().RoomRemoved(assigned)
	}()

	// Send confirmation back on control stream with the actually assigned name
	json.NewEncoder(stream).Encode(map[string]string{"status": "ok", "room": assigned})

	// Keep session alive until context cancels or session closes
	select {
	case <-ctx.Done():
	case <-session.Context().Done():
	}

	// Drain — read to EOF to detect clean close
	io.ReadAll(stream)
	log.Printf("wt: session %q disconnected", assigned)
}
