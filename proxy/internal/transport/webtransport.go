package transport

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"

	"github.com/user/minecraft-web/proxy/internal/router"
)

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

	if reg.Room == "" {
		reg.Room = "default"
	}

	log.Printf("wt: session registered for room %q", reg.Room)

	s.Router.Register(reg.Room, &router.Session{WT: session})
	defer s.Router.Remove(reg.Room)

	// Send confirmation back on control stream
	json.NewEncoder(stream).Encode(map[string]string{"status": "ok", "room": reg.Room})

	// Keep session alive until context cancels or session closes
	select {
	case <-ctx.Done():
	case <-session.Context().Done():
	}

	// Drain — read to EOF to detect clean close
	io.ReadAll(stream)
	log.Printf("wt: session %q disconnected", reg.Room)
}
