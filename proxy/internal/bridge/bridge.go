package bridge

import (
	"io"
	"sync"
)

// Bridge forwards bytes bidirectionally between a TCP connection and a WebTransport stream.
type Bridge struct {
	tcp  io.ReadWriteCloser
	wt   io.ReadWriteCloser
	done chan struct{}
	once sync.Once
}

// New creates a Bridge between two ReadWriteClosers and starts forwarding.
func New(tcp io.ReadWriteCloser, wt io.ReadWriteCloser) *Bridge {
	b := &Bridge{
		tcp:  tcp,
		wt:   wt,
		done: make(chan struct{}),
	}
	go b.forward(tcp, wt)
	go b.forward(wt, tcp)
	return b
}

func (b *Bridge) forward(dst io.Writer, src io.Reader) {
	io.Copy(dst, src)
	b.Close()
}

// Done returns a channel that is closed when the bridge shuts down.
func (b *Bridge) Done() <-chan struct{} {
	return b.done
}

// Close shuts down both connections and signals done.
func (b *Bridge) Close() {
	b.once.Do(func() {
		b.tcp.Close()
		b.wt.Close()
		close(b.done)
	})
}
