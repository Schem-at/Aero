package router

import (
	"io"
	"sync"
)

// Stream is a bidirectional byte stream (WebTransport stream or WebSocket conn).
type Stream interface {
	io.Reader
	io.Writer
	Close() error
}

// Session represents a connected browser host that can accept new streams.
type Session interface {
	// OpenStream opens a new bidirectional stream to the browser.
	OpenStream() (Stream, error)
	// Close terminates the session.
	Close()
	// Done returns a channel closed when the session ends.
	Done() <-chan struct{}
}

// Router maps subdomain names to active sessions.
type Router struct {
	mu       sync.RWMutex
	sessions map[string]Session
}

// New creates an empty Router.
func New() *Router {
	return &Router{sessions: make(map[string]Session)}
}

// TryRegister registers only if the subdomain is not already taken.
// Returns true if registered, false if the name is already in use.
func (r *Router) TryRegister(subdomain string, session Session) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.sessions[subdomain]; exists {
		return false
	}
	r.sessions[subdomain] = session
	return true
}

// Lookup returns the session for a subdomain, or nil if not found.
func (r *Router) Lookup(subdomain string) Session {
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
