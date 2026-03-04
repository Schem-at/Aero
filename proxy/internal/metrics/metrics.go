package metrics

import (
	"encoding/json"
	"net/http"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// Metrics tracks proxy-wide statistics.
type Metrics struct {
	startTime time.Time

	// Atomic counters for high-frequency updates
	bytesIn       atomic.Int64
	bytesOut      atomic.Int64
	totalBridges  atomic.Int64
	failedBridges atomic.Int64

	// Guarded by mu for room/connection tracking
	mu      sync.RWMutex
	rooms   map[string]*RoomMetrics
	clients int // currently active bridges
}

// RoomMetrics tracks per-room statistics.
type RoomMetrics struct {
	Name          string    `json:"name"`
	RegisteredAt  time.Time `json:"registered_at"`
	ActiveClients int       `json:"active_clients"`
	TotalClients  int       `json:"total_clients"`
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
}

var global = &Metrics{
	startTime: time.Now(),
	rooms:     make(map[string]*RoomMetrics),
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

// BridgeStarted records a new TCP↔WT bridge.
func (m *Metrics) BridgeStarted(room string) {
	m.totalBridges.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clients++
	if rm, ok := m.rooms[room]; ok {
		rm.ActiveClients++
		rm.TotalClients++
	}
}

// BridgeStopped records a bridge teardown.
func (m *Metrics) BridgeStopped(room string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clients--
	if rm, ok := m.rooms[room]; ok {
		rm.ActiveClients--
	}
}

// BridgeFailed records a failed bridge attempt.
func (m *Metrics) BridgeFailed() {
	m.failedBridges.Add(1)
}

// AddBytesIn adds to the inbound byte counter.
func (m *Metrics) AddBytesIn(n int64) { m.bytesIn.Add(n) }

// AddBytesOut adds to the outbound byte counter.
func (m *Metrics) AddBytesOut(n int64) { m.bytesOut.Add(n) }

// Snapshot returns a point-in-time copy of all metrics.
func (m *Metrics) Snapshot() *Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	rooms := make([]*RoomMetrics, 0, len(m.rooms))
	for _, rm := range m.rooms {
		cp := *rm
		rooms = append(rooms, &cp)
	}

	uptime := time.Since(m.startTime)
	return &Snapshot{
		Uptime:        uptime.Round(time.Second).String(),
		UptimeSec:     uptime.Seconds(),
		Rooms:         len(m.rooms),
		ActiveClients: m.clients,
		TotalBridges:  m.totalBridges.Load(),
		FailedBridges: m.failedBridges.Load(),
		BytesIn:       m.bytesIn.Load(),
		BytesOut:      m.bytesOut.Load(),
		GoRoutines:    runtime.NumGoroutine(),
		MemAllocMB:    float64(memStats.Alloc) / (1024 * 1024),
		RoomDetails:   rooms,
	}
}

// Handler returns an HTTP handler that serves the dashboard and JSON API.
func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/proxy/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(global.Snapshot())
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(dashboardHTML))
	})
	return mux
}

const dashboardHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aero — Proxy Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #09090b; color: #fafafa; padding: 24px;
    min-height: 100vh;
  }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #a1a1aa; }
  h1 span { color: #fafafa; }
  .error-banner {
    background: #451a03; border: 1px solid #92400e; border-radius: 8px;
    padding: 8px 12px; font-size: 12px; color: #fbbf24; margin-bottom: 16px;
  }
  .grid {
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    margin-bottom: 24px;
  }
  .card {
    background: #18181b; border: 1px solid #27272a; border-radius: 10px;
    padding: 14px 16px;
  }
  .card-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: #71717a; display: flex; align-items: center; gap: 6px;
    margin-bottom: 4px;
  }
  .card-value {
    font-size: 22px; font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .green { color: #34d399; }
  .section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: #71717a; margin-bottom: 8px; font-weight: 500;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: 'SF Mono', 'Cascadia Code', monospace; }
  th { text-align: left; padding: 6px 10px; color: #71717a; font-weight: 500;
       border-bottom: 1px solid #27272a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  th.r { text-align: right; }
  td { padding: 6px 10px; border-bottom: 1px solid #27272a20; color: #d4d4d8; }
  td.r { text-align: right; }
  td.name { font-weight: 500; color: #fafafa; }
  .empty { color: #52525b; font-size: 13px; padding: 20px 0; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; }
  .dot-active { background: #34d399; box-shadow: 0 0 6px #34d39960; }
  .dot-idle { background: #52525b; }
  .failed { color: #f87171; font-size: 12px; margin-bottom: 16px; }
  .status-bar {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: #52525b; margin-bottom: 20px;
  }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; }
  .status-dot.ok { background: #34d399; }
  .status-dot.err { background: #f87171; }
</style>
</head>
<body>
  <h1>Aero <span>Proxy</span></h1>
  <div class="status-bar">
    <div class="status-dot" id="status-dot"></div>
    <span id="status-text">Connecting...</span>
  </div>
  <div id="error-banner" class="error-banner" style="display:none"></div>
  <div class="grid" id="cards"></div>
  <div id="failed-banner" class="failed"></div>
  <div class="section-title">Active Rooms</div>
  <div id="rooms"></div>

<script>
function fmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}
function fmtUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

function renderCards(s) {
  const items = [
    ['Uptime', fmtUptime(s.uptime_sec), ''],
    ['Rooms', s.rooms, s.rooms > 0 ? 'green' : ''],
    ['Active Clients', s.active_clients, s.active_clients > 0 ? 'green' : ''],
    ['Total Bridges', s.total_bridges, ''],
    ['Bytes In', fmtBytes(s.bytes_in), ''],
    ['Bytes Out', fmtBytes(s.bytes_out), ''],
    ['Goroutines', s.goroutines, ''],
    ['Memory', s.mem_alloc_mb.toFixed(1) + ' MB', ''],
  ];
  document.getElementById('cards').innerHTML = items.map(([label, value, cls]) =>
    '<div class="card"><div class="card-label">' + label +
    '</div><div class="card-value ' + cls + '">' + value + '</div></div>'
  ).join('');
}

function renderRooms(rooms) {
  const el = document.getElementById('rooms');
  if (!rooms || rooms.length === 0) {
    el.innerHTML = '<div class="empty">No rooms registered. Start a server in your browser to create one.</div>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Room</th><th class="r">Clients</th><th class="r">Total</th><th class="r">Since</th></tr></thead><tbody>' +
    rooms.map(r => {
      const dotCls = r.active_clients > 0 ? 'dot-active' : 'dot-idle';
      return '<tr><td class="name"><span class="dot ' + dotCls + '"></span>' + r.name + '</td>' +
        '<td class="r">' + r.active_clients + '</td>' +
        '<td class="r">' + r.total_clients + '</td>' +
        '<td class="r" style="color:#71717a">' + fmtTime(r.registered_at) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

let lastOk = false;
async function poll() {
  try {
    const res = await fetch('/api/proxy/stats');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const s = await res.json();
    renderCards(s);
    renderRooms(s.room_details);
    if (s.failed_bridges > 0) {
      document.getElementById('failed-banner').textContent =
        s.failed_bridges + ' failed bridge attempt' + (s.failed_bridges !== 1 ? 's' : '');
    } else {
      document.getElementById('failed-banner').textContent = '';
    }
    document.getElementById('error-banner').style.display = 'none';
    document.getElementById('status-dot').className = 'status-dot ok';
    document.getElementById('status-text').textContent = 'Connected';
    lastOk = true;
  } catch (e) {
    document.getElementById('status-dot').className = 'status-dot err';
    document.getElementById('status-text').textContent = 'Disconnected';
    if (lastOk) {
      document.getElementById('error-banner').style.display = 'block';
      document.getElementById('error-banner').textContent = 'Connection lost: ' + e.message;
    }
    lastOk = false;
  }
}
poll();
setInterval(poll, 2000);
</script>
</body>
</html>`
