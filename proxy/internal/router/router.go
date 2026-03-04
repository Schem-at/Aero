package router

import (
	"context"
	"sync"

	"github.com/quic-go/webtransport-go"
)

// Session represents a connected browser host's WebTransport session.
type Session struct {
	WT *webtransport.Session
}

// OpenStream opens a new bidirectional stream on the WebTransport session.
func (s *Session) OpenStream(ctx context.Context) (*webtransport.Stream, error) {
	return s.WT.OpenStreamSync(ctx)
}

// Router maps subdomain names to active WebTransport sessions.
type Router struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// New creates an empty Router.
func New() *Router {
	return &Router{sessions: make(map[string]*Session)}
}

// Register adds a session for the given subdomain.
func (r *Router) Register(subdomain string, session *Session) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[subdomain] = session
}

// Lookup returns the session for a subdomain, or nil if not found.
func (r *Router) Lookup(subdomain string) *Session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.sessions[subdomain]
}

// Remove deletes a session entry.
func (r *Router) Remove(subdomain string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, subdomain)
}
