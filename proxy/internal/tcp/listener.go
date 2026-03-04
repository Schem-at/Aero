package tcp

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"strings"

	"github.com/user/minecraft-web/proxy/internal/bridge"
	"github.com/user/minecraft-web/proxy/internal/router"
)

// Listener accepts incoming Minecraft client TCP connections.
type Listener struct {
	Addr   string
	Domain string
	Router *router.Router
}

// ListenAndServe starts accepting TCP connections.
func (l *Listener) ListenAndServe(ctx context.Context) error {
	ln, err := net.Listen("tcp", l.Addr)
	if err != nil {
		return fmt.Errorf("tcp listen: %w", err)
	}
	defer ln.Close()

	log.Printf("tcp: listening on %s", l.Addr)

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
				log.Printf("tcp: accept error: %v", err)
				continue
			}
		}
		go l.handleConn(ctx, conn)
	}
}

func (l *Listener) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	// Read the full handshake packet to extract the server address
	raw, serverAddr, err := readHandshake(conn)
	if err != nil {
		log.Printf("tcp: handshake read failed: %v", err)
		return
	}

	// Extract subdomain from server address (e.g., "myroom.localhost" → "myroom")
	subdomain := extractSubdomain(serverAddr, l.Domain)
	log.Printf("tcp: client connecting to room %q (address: %s)", subdomain, serverAddr)

	// Look up the browser session
	session := l.Router.Lookup(subdomain)
	if session == nil {
		log.Printf("tcp: no session for room %q", subdomain)
		return
	}

	// Open a new WebTransport stream for this TCP client
	stream, err := session.OpenStream(ctx)
	if err != nil {
		log.Printf("tcp: open WT stream failed: %v", err)
		return
	}

	// Replay the handshake bytes so the browser WASM sees them
	if _, err := stream.Write(raw); err != nil {
		log.Printf("tcp: replay handshake failed: %v", err)
		stream.Close()
		return
	}

	// Bridge the TCP connection and WebTransport stream
	b := bridge.New(conn, stream)
	log.Printf("tcp: bridge active for room %q", subdomain)

	select {
	case <-b.Done():
	case <-ctx.Done():
		b.Close()
	}
	log.Printf("tcp: bridge closed for room %q", subdomain)
}

// readHandshake reads a Minecraft handshake packet and returns the raw bytes and the server address field.
func readHandshake(r io.Reader) (raw []byte, serverAddr string, err error) {
	// Read packet length (varint)
	packetLen, lenBytes, err := readVarInt(r)
	if err != nil {
		return nil, "", fmt.Errorf("read packet length: %w", err)
	}
	if packetLen < 1 || packetLen > 1024 {
		return nil, "", fmt.Errorf("invalid packet length: %d", packetLen)
	}

	// Read the full packet body
	body := make([]byte, packetLen)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, "", fmt.Errorf("read packet body: %w", err)
	}

	// Combine length prefix + body as the raw bytes to replay
	raw = append(lenBytes, body...)

	// Parse packet ID (should be 0x00 for handshake)
	offset := 0
	packetID, n := binary.Uvarint(body)
	if n <= 0 || packetID != 0 {
		return raw, "", fmt.Errorf("not a handshake packet (id=%d)", packetID)
	}
	offset += n

	// Skip protocol version (varint)
	_, n = binary.Uvarint(body[offset:])
	if n <= 0 {
		return raw, "", fmt.Errorf("bad protocol version varint")
	}
	offset += n

	// Read server address (varint-prefixed string)
	addrLen, n := binary.Uvarint(body[offset:])
	if n <= 0 {
		return raw, "", fmt.Errorf("bad address length varint")
	}
	offset += n

	if offset+int(addrLen) > len(body) {
		return raw, "", fmt.Errorf("address length exceeds packet")
	}
	serverAddr = string(body[offset : offset+int(addrLen)])

	return raw, serverAddr, nil
}

// readVarInt reads a Minecraft-style varint from the reader.
func readVarInt(r io.Reader) (int, []byte, error) {
	var result int
	var shift uint
	var buf []byte
	b := make([]byte, 1)

	for {
		if _, err := io.ReadFull(r, b); err != nil {
			return 0, nil, err
		}
		buf = append(buf, b[0])
		result |= int(b[0]&0x7F) << shift
		if b[0]&0x80 == 0 {
			return result, buf, nil
		}
		shift += 7
		if shift >= 35 {
			return 0, nil, fmt.Errorf("varint too long")
		}
	}
}

// extractSubdomain extracts the subdomain from a Minecraft server address.
// e.g., "myroom.localhost" with domain "localhost" → "myroom"
// If no subdomain, returns "default".
func extractSubdomain(addr, domain string) string {
	// Strip any FML markers or trailing dots
	addr = strings.Split(addr, "\x00")[0]
	addr = strings.TrimSuffix(addr, ".")

	if !strings.HasSuffix(addr, "."+domain) {
		return "default"
	}

	sub := strings.TrimSuffix(addr, "."+domain)
	if sub == "" || strings.Contains(sub, ".") {
		return "default"
	}
	return sub
}
