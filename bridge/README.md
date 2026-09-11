# SentryWing ESP32-CAM to WebSocket Live Feed Bridge

A lightweight, standalone Python bridge service that connects to an **ESP32-CAM HTTP MJPEG video stream** (pull model) and pushes frames over **WebSocket** into the SentryWing dashboard's `/ws/live-feed` field-source endpoint (push model).

---

## Why this Bridge Exists

1. **Firmware Decoupling**: Standard ESP32-CAM firmware (e.g. `CameraWebServer`) exposes video via an HTTP MJPEG stream (HTTP GET `/stream`).
2. **Dashboard Contract**: The SentryWing Live Feed Viewer (for Veterinarians & Forest Officers) consumes a real-time WebSocket stream on `/ws/live-feed`.
3. **Bridge Solution**: Pulls frames from the ESP32-CAM via OpenCV / HTTP multipart, stamps fixed geolocation coordinates (`ESP32_LAT`, `ESP32_LNG`), optionally runs YOLO detection & target tracking, and pushes frames to `/ws/live-feed`.

---

## Configuration (`.env` or CLI)

Edit `bridge/.env` or pass command-line arguments:

```env
# ESP32-CAM MJPEG HTTP Stream URL (from Serial Monitor or Wi-Fi Router)
ESP32_STREAM_URL=http://192.168.4.1/stream

# SentryWing Dashboard /ws/live-feed WebSocket endpoint
DASHBOARD_WS_URL=ws://127.0.0.1:8000/ws/live-feed

# Camera Post Identifier
ESP32_SOURCE_ID=esp32-cam-1

# Fixed Geolocation (ESP32 modules do not have onboard GPS)
ESP32_LAT=29.5312
ESP32_LNG=78.7744
ESP32_LOCATION_NAME=Corbett Sector 4 Outpost (ESP32 Unit 1)

# Target Transmission Frame Rate (FPS)
ESP32_TARGET_FPS=12

# Optional On-Bridge Detection (runs YOLOv8 + TargetTracker before pushing)
ENABLE_DETECTION=true
CONFIDENCE_THRESHOLD=0.25
```

---

## How to Run

### 1. Basic Run (reads `.env`):
```bash
python bridge/esp32_bridge.py
```

### 2. Custom Stream URL via CLI:
```bash
python bridge/esp32_bridge.py --stream-url http://192.168.1.105:81/stream --dashboard-ws ws://127.0.0.1:8000/ws/live-feed
```

### 3. Raw Video Mode (No detection overhead):
```bash
python bridge/esp32_bridge.py --raw
```

### 4. Neural Detection Enabled:
```bash
python bridge/esp32_bridge.py --detect
```

---

## Message Schema Pushed to `/ws/live-feed`

The bridge pushes JSON payloads adhering strictly to the contract:

```json
{
  "source_id": "esp32-cam-1",
  "frame": "data:image/jpeg;base64,...",
  "lat": 29.5312,
  "lng": 78.7744,
  "timestamp": "2026-09-11T04:25:30.123Z",
  "locked": false,
  "bbox": null,
  "direction": null,
  "dx": null,
  "dy": null,
  "predicted": null,
  "attributes": null,
  "location": {
    "lat": 29.5312,
    "lng": 78.7744,
    "name": "Corbett Sector 4 Outpost (ESP32 Unit 1)"
  },
  "lock": null
}
```

When neural detection is enabled and an animal is locked:
- `locked`: `true`
- `bbox`: `[x1, y1, x2, y2]` (normalized 0.0 - 1.0)
- `direction`: `"UP_LEFT" | "DOWN_RIGHT" | "CENTERED"`
- `attributes`: `{"vitality_status": "...", "estimated_weight_kg": ...}`

---

## Verification & Self-Healing
- **Field Wi-Fi Drops**: Automatically retries connecting to the ESP32-CAM stream with exponential backoff.
- **Dashboard Disconnects**: Reconnects to the WebSocket server automatically without crashing.
- **Heartbeat Logging**:
  ```
  [HEARTBEAT] ESP32-CAM: YES (ONLINE) | Dashboard WS: YES (ONLINE) | Rate: 12.3 FPS | Total Frames: 142
  ```
