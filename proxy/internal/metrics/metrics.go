package metrics

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// ClientInfo represents a connected client visible in the API.
type ClientInfo struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	IP          string  `json:"ip"`
	Room        string  `json:"room"`
	ConnectedAt string  `json:"connected_at"`
	DurationSec float64 `json:"duration_sec"`
	BytesIn     int64   `json:"bytes_in"`
	BytesOut    int64   `json:"bytes_out"`
}

// clientState is the internal per-client tracking.
type clientState struct {
	username    string
	ip          string
	room        string
	connectedAt time.Time
	bytesIn     atomic.Int64
	bytesOut    atomic.Int64
}

// Metrics tracks proxy-wide statistics.
type Metrics struct {
	startTime time.Time

	// Atomic counters for high-frequency updates
	totalBridges  atomic.Int64
	failedBridges atomic.Int64

	// Accumulated bytes from disconnected clients
	disconnectedBytesIn  atomic.Int64
	disconnectedBytesOut atomic.Int64

	// Guarded by mu for room/connection tracking
	mu           sync.RWMutex
	rooms        map[string]*RoomMetrics
	clients      int // currently active bridges
	clientMap    map[string]*clientState
	nextClientID int64
}

// RoomMetrics tracks per-room statistics.
type RoomMetrics struct {
	Name          string       `json:"name"`
	RegisteredAt  time.Time    `json:"registered_at"`
	ActiveClients int          `json:"active_clients"`
	TotalClients  int          `json:"total_clients"`
	Clients       []ClientInfo `json:"clients,omitempty"`
}

// Snapshot is the JSON-serializable metrics response.
type Snapshot struct {
	Uptime        string         `json:"uptime"`
	UptimeSec     float64        `json:"uptime_sec"`
	Rooms         int            `json:"rooms"`
	ActiveClients int            `json:"active_clients"`
	TotalBridges  int64          `json:"total_bridges"`
	FailedBridges int64          `json:"failed_bridges"`
	BytesIn       int64          `json:"bytes_in"`
	BytesOut      int64          `json:"bytes_out"`
	GoRoutines    int            `json:"goroutines"`
	MemAllocMB    float64        `json:"mem_alloc_mb"`
	RoomDetails   []*RoomMetrics `json:"room_details"`
	Clients       []ClientInfo   `json:"clients"`
}

var global = &Metrics{
	startTime: time.Now(),
	rooms:     make(map[string]*RoomMetrics),
	clientMap: make(map[string]*clientState),
}

// Get returns the global metrics instance.
func Get() *Metrics { return global }

// RoomRegistered records a new WebTransport session.
func (m *Metrics) RoomRegistered(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rooms[name] = &RoomMetrics{
		Name:         name,
		RegisteredAt: time.Now(),
	}
}

// RoomRemoved records a WebTransport session disconnect.
func (m *Metrics) RoomRemoved(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, name)
}

// BridgeStarted records a new TCP↔WT bridge and returns a client ID.
func (m *Metrics) BridgeStarted(room, username, ip string) string {
	m.totalBridges.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()

	m.nextClientID++
	id := fmt.Sprintf("c%d", m.nextClientID)

	m.clientMap[id] = &clientState{
		username:    username,
		ip:          ip,
		room:        room,
		connectedAt: time.Now(),
	}

	m.clients++
	if rm, ok := m.rooms[room]; ok {
		rm.ActiveClients++
		rm.TotalClients++
	}
	return id
}

// BridgeStopped records a bridge teardown.
func (m *Metrics) BridgeStopped(clientID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cs, ok := m.clientMap[clientID]
	if !ok {
		return
	}

	// Accumulate bytes from this client into disconnected totals
	m.disconnectedBytesIn.Add(cs.bytesIn.Load())
	m.disconnectedBytesOut.Add(cs.bytesOut.Load())

	m.clients--
	if rm, ok := m.rooms[cs.room]; ok {
		rm.ActiveClients--
	}
	delete(m.clientMap, clientID)
}

// BridgeFailed records a failed bridge attempt.
func (m *Metrics) BridgeFailed() {
	m.failedBridges.Add(1)
}

// ClientBytesCounters returns the atomic byte counters for a client.
// The bridge writes directly to these counters.
func (m *Metrics) ClientBytesCounters(clientID string) (*atomic.Int64, *atomic.Int64) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cs, ok := m.clientMap[clientID]
	if !ok {
		// Return dummy counters if client not found (shouldn't happen)
		return &atomic.Int64{}, &atomic.Int64{}
	}
	return &cs.bytesIn, &cs.bytesOut
}

// Snapshot returns a point-in-time copy of all metrics.
func (m *Metrics) Snapshot() *Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	now := time.Now()

	// Build per-client info and compute live bytes
	var liveBytesIn, liveBytesOut int64
	allClients := make([]ClientInfo, 0, len(m.clientMap))
	// Group clients by room for room details
	roomClients := make(map[string][]ClientInfo)

	for id, cs := range m.clientMap {
		bIn := cs.bytesIn.Load()
		bOut := cs.bytesOut.Load()
		liveBytesIn += bIn
		liveBytesOut += bOut

		ci := ClientInfo{
			ID:          id,
			Username:    cs.username,
			IP:          cs.ip,
			Room:        cs.room,
			ConnectedAt: cs.connectedAt.Format(time.RFC3339),
			DurationSec: now.Sub(cs.connectedAt).Seconds(),
			BytesIn:     bIn,
			BytesOut:    bOut,
		}
		allClients = append(allClients, ci)
		roomClients[cs.room] = append(roomClients[cs.room], ci)
	}

	rooms := make([]*RoomMetrics, 0, len(m.rooms))
	for _, rm := range m.rooms {
		cp := *rm
		cp.Clients = roomClients[cp.Name]
		rooms = append(rooms, &cp)
	}

	totalBytesIn := m.disconnectedBytesIn.Load() + liveBytesIn
	totalBytesOut := m.disconnectedBytesOut.Load() + liveBytesOut

	uptime := time.Since(m.startTime)
	return &Snapshot{
		Uptime:        uptime.Round(time.Second).String(),
		UptimeSec:     uptime.Seconds(),
		Rooms:         len(m.rooms),
		ActiveClients: m.clients,
		TotalBridges:  m.totalBridges.Load(),
		FailedBridges: m.failedBridges.Load(),
		BytesIn:       totalBytesIn,
		BytesOut:      totalBytesOut,
		GoRoutines:    runtime.NumGoroutine(),
		MemAllocMB:    float64(memStats.Alloc) / (1024 * 1024),
		RoomDetails:   rooms,
		Clients:       allClients,
	}
}

// Handler returns an HTTP handler that serves the JSON API.
func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/proxy/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(global.Snapshot())
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintln(w, "Aero Proxy — API server")
		fmt.Fprintln(w, "GET /api/proxy/stats for metrics JSON")
	})
	return mux
}
