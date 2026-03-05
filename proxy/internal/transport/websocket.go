package transport

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"

	"github.com/user/minecraft-web/proxy/internal/metrics"
	"github.com/user/minecraft-web/proxy/internal/router"
)

// WebSocket multiplexing protocol:
//   [1 byte: msg_type][4 bytes: stream_id (big-endian)][payload...]
//
// Message types:
const (
	wsMsgData        = 0x00 // Carries stream payload
	wsMsgStreamOpen  = 0x01 // Proxy→browser: new stream opened
	wsMsgStreamClose = 0x02 // Either direction: stream closed
)

// WSHandler handles WebSocket connections for browsers without WebTransport (e.g. iOS Safari).
type WSHandler struct {
	Router      *router.Router
	ActiveRooms *atomic.Int64
	upgrader    websocket.Upgrader
}

func NewWSHandler(r *router.Router, activeRooms *atomic.Int64) *WSHandler {
	return &WSHandler{
		Router:      r,
		ActiveRooms: activeRooms,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade failed: %v", err)
		return
	}
	go h.handleConnection(conn)
}

func (h *WSHandler) handleConnection(conn *websocket.Conn) {
	defer conn.Close()

	if h.ActiveRooms.Load() >= maxRooms {
		log.Printf("ws: rejecting session (at room capacity %d)", maxRooms)
		return
	}

	sess := newWSSession(conn)

	// Read registration from control channel (stream 0)
	regData, err := sess.readControl()
	if err != nil {
		log.Printf("ws: read registration failed: %v", err)
		return
	}

	var reg registration
	if err := json.Unmarshal(regData, &reg); err != nil {
		log.Printf("ws: parse registration failed: %v", err)
		return
	}

	// Sanitize inputs
	preferred := sanitizeRoomName(reg.Room)
	if preferred == "" {
		preferred = generateName()
	}
	reg.MOTD = truncateMOTD(reg.MOTD)

	// Try to register with the preferred name, then with suffixes
	assigned := preferred
	if !h.Router.TryRegister(assigned, sess) {
		registered := false
		for i := 0; i < 10; i++ {
			assigned = preferred + "-" + randomSuffix()
			if h.Router.TryRegister(assigned, sess) {
				registered = true
				break
			}
		}
		if !registered {
			for i := 0; i < 10; i++ {
				assigned = generateName() + "-" + randomSuffix()
				if h.Router.TryRegister(assigned, sess) {
					registered = true
					break
				}
			}
			if !registered {
				log.Printf("ws: failed to find available room name after retries")
				resp, _ := json.Marshal(map[string]string{"status": "error", "error": "no room name available"})
				sess.writeControl(resp)
				return
			}
		}
	}

	h.ActiveRooms.Add(1)
	log.Printf("ws: session registered for room %q (requested %q) [%d active]", assigned, preferred, h.ActiveRooms.Load())
	metrics.Get().RoomRegistered(assigned)
	if reg.Public {
		metrics.Get().SetRoomPublic(assigned, true)
	}
	if reg.MOTD != "" {
		metrics.Get().SetRoomMOTD(assigned, reg.MOTD)
	}
	if reg.Favicon != "" {
		metrics.Get().SetRoomFavicon(assigned, reg.Favicon)
	}
	defer func() {
		h.Router.Remove(assigned)
		metrics.Get().RoomRemoved(assigned)
		h.ActiveRooms.Add(-1)
	}()

	// Send confirmation
	resp, _ := json.Marshal(map[string]string{"status": "ok", "room": assigned})
	if err := sess.writeControl(resp); err != nil {
		log.Printf("ws: write confirmation failed: %v", err)
		return
	}

	// Listen for control channel updates in background
	go func() {
		for {
			data, err := sess.readControl()
			if err != nil {
				return
			}
			var update roomUpdate
			if err := json.Unmarshal(data, &update); err != nil {
				continue
			}
			if update.Public != nil {
				metrics.Get().SetRoomPublic(assigned, *update.Public)
				log.Printf("ws: room %q public=%v", assigned, *update.Public)
			}
			if update.MOTD != nil {
				motd := truncateMOTD(*update.MOTD)
				metrics.Get().SetRoomMOTD(assigned, motd)
				log.Printf("ws: room %q motd=%q", assigned, motd)
			}
			if update.Favicon != nil {
				metrics.Get().SetRoomFavicon(assigned, *update.Favicon)
			}
		}
	}()

	// Wait until WebSocket disconnects
	<-sess.Done()
	log.Printf("ws: session %q disconnected", assigned)
}

// --- wsSession implements router.Session ---

type wsSession struct {
	conn    *websocket.Conn
	writeMu sync.Mutex // protects conn writes
	streams sync.Map   // uint32 → *wsStream
	nextID  atomic.Uint32
	done    chan struct{}
	once    sync.Once
	control chan []byte // buffered control messages (stream 0)
}

func newWSSession(conn *websocket.Conn) *wsSession {
	s := &wsSession{
		conn:    conn,
		done:    make(chan struct{}),
		control: make(chan []byte, 32),
	}
	go s.readLoop()
	return s
}

func (s *wsSession) readLoop() {
	defer s.closeDone()
	for {
		_, data, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		if len(data) < 5 {
			continue
		}

		msgType := data[0]
		streamID := binary.BigEndian.Uint32(data[1:5])
		payload := data[5:]

		switch msgType {
		case wsMsgData:
			if streamID == 0 {
				select {
				case s.control <- append([]byte(nil), payload...):
				default:
				}
			} else if v, ok := s.streams.Load(streamID); ok {
				v.(*wsStream).pushData(payload)
			}
		case wsMsgStreamClose:
			if v, ok := s.streams.LoadAndDelete(streamID); ok {
				v.(*wsStream).closeRead()
			}
		}
	}
}

func (s *wsSession) sendFrame(msgType byte, streamID uint32, payload []byte) error {
	header := make([]byte, 5)
	header[0] = msgType
	binary.BigEndian.PutUint32(header[1:5], streamID)

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteMessage(websocket.BinaryMessage, append(header, payload...))
}

func (s *wsSession) OpenStream() (router.Stream, error) {
	select {
	case <-s.done:
		return nil, io.ErrClosedPipe
	default:
	}

	id := s.nextID.Add(1)
	stream := &wsStream{
		id:      id,
		session: s,
		buf:     make(chan []byte, 128),
	}
	s.streams.Store(id, stream)

	// Notify browser that a new stream is opened
	if err := s.sendFrame(wsMsgStreamOpen, id, nil); err != nil {
		s.streams.Delete(id)
		return nil, err
	}

	return stream, nil
}

func (s *wsSession) Close() {
	s.closeDone()
}

func (s *wsSession) Done() <-chan struct{} {
	return s.done
}

func (s *wsSession) closeDone() {
	s.once.Do(func() {
		s.conn.Close()
		close(s.done)
	})
}

func (s *wsSession) readControl() ([]byte, error) {
	select {
	case data := <-s.control:
		return data, nil
	case <-s.done:
		return nil, io.ErrClosedPipe
	}
}

func (s *wsSession) writeControl(data []byte) error {
	return s.sendFrame(wsMsgData, 0, data)
}

// --- wsStream implements router.Stream ---

type wsStream struct {
	id      uint32
	session *wsSession
	buf     chan []byte
	readBuf []byte
	closed  atomic.Bool
}

func (st *wsStream) pushData(data []byte) {
	if st.closed.Load() {
		return
	}
	select {
	case st.buf <- append([]byte(nil), data...):
	default:
		// Buffer full — drop oldest to prevent blocking
		select {
		case <-st.buf:
		default:
		}
		st.buf <- append([]byte(nil), data...)
	}
}

func (st *wsStream) closeRead() {
	if st.closed.CompareAndSwap(false, true) {
		close(st.buf)
	}
}

func (st *wsStream) Read(p []byte) (int, error) {
	if len(st.readBuf) > 0 {
		n := copy(p, st.readBuf)
		st.readBuf = st.readBuf[n:]
		return n, nil
	}

	data, ok := <-st.buf
	if !ok {
		return 0, io.EOF
	}

	n := copy(p, data)
	if n < len(data) {
		st.readBuf = data[n:]
	}
	return n, nil
}

func (st *wsStream) Write(p []byte) (int, error) {
	if st.closed.Load() {
		return 0, io.ErrClosedPipe
	}
	err := st.session.sendFrame(wsMsgData, st.id, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

func (st *wsStream) Close() error {
	if st.closed.CompareAndSwap(false, true) {
		st.session.sendFrame(wsMsgStreamClose, st.id, nil)
		st.session.streams.Delete(st.id)
		close(st.buf)
	}
	return nil
}
