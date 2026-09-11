"""
ESP32-CAM MJPEG to WebSocket Bridge for SentryWing Wildlife Intelligence.
Pulls continuous HTTP MJPEG video frames from an ESP32-CAM module and pushes them
over WebSocket to the dashboard's /ws/live-feed field-source endpoint.

Features:
  - Dual-mode frame puller: OpenCV VideoCapture primary with HTTP MJPEG multipart fallback.
  - Automatic reconnection with exponential backoff on field Wi-Fi drops.
  - Configurable geolocation (ESP32_LAT, ESP32_LNG, ESP32_LOCATION_NAME).
  - Continuous status heartbeat logging (ESP32: YES/NO | Dashboard: YES/NO | FPS).
  - Optional on-bridge neural detection and target locking (reusing backend inference & tracker).
  - Strictly adheres to the dashboard's /ws/live-feed contract.
"""

import argparse
import asyncio
import base64
import json
import logging
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

import cv2
import numpy as np

# Add backend directory to sys.path so we can optionally reuse inference & tracker
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Optional environment loading
try:
    from dotenv import load_dotenv
    # Load bridge/.env first, fallback to backend/.env
    if (SCRIPT_DIR / ".env").exists():
        load_dotenv(SCRIPT_DIR / ".env")
    elif (BACKEND_DIR / ".env").exists():
        load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [ESP32-Bridge]: %(message)s"
)
logger = logging.getLogger("esp32_bridge")


# =============================================================================
# OPTIONAL INFERENCE & TRACKER IMPORT
# =============================================================================
DETECTION_AVAILABLE = False
run_detection = None
run_attributes = None
TargetTracker = None

def try_load_detector():
    global DETECTION_AVAILABLE, run_detection, run_attributes, TargetTracker
    try:
        from inference import run_detection as rd, run_attributes as ra
        from tracker import TargetTracker as TT
        run_detection = rd
        run_attributes = ra
        TargetTracker = TT
        DETECTION_AVAILABLE = True
        logger.info("Neural detector and target tracker loaded successfully for on-bridge inference.")
    except Exception as e:
        DETECTION_AVAILABLE = False
        logger.info(f"Running in raw stream mode (detector not loaded: {e}).")


# =============================================================================
# CONFIGURATION
# =============================================================================
class BridgeConfig:
    def __init__(self, args=None):
        self.esp32_stream_url = (
            (args and args.stream_url) or
            os.getenv("ESP32_STREAM_URL") or
            "http://192.168.4.1/stream"
        ).strip()

        self.dashboard_ws_url = (
            (args and args.dashboard_ws) or
            os.getenv("DASHBOARD_WS_URL") or
            os.getenv("PUBLISH_TARGET_URL") or
            "ws://127.0.0.1:8000/ws/live-feed"
        ).strip()

        self.source_id = (
            (args and args.source_id) or
            os.getenv("ESP32_SOURCE_ID") or
            "esp32-cam-1"
        ).strip()

        self.lat = float((args and args.lat) or os.getenv("ESP32_LAT") or "29.5312")
        self.lng = float((args and args.lng) or os.getenv("ESP32_LNG") or "78.7744")
        self.location_name = (
            (args and args.location_name) or
            os.getenv("ESP32_LOCATION_NAME") or
            "Corbett Sector 4 Outpost (ESP32 Unit 1)"
        ).strip()

        self.target_fps = int((args and args.fps) or os.getenv("ESP32_TARGET_FPS") or "12")
        self.enable_detection = (
            (args and args.detect) if (args and args.detect is not None)
            else os.getenv("ENABLE_DETECTION", "true").lower() in ("1", "true", "yes")
        )
        self.confidence_threshold = float(os.getenv("CONFIDENCE_THRESHOLD") or "0.25")


# =============================================================================
# ESP32 STREAM READER
# =============================================================================
class ESP32StreamReader:
    """
    Connects to ESP32-CAM MJPEG HTTP stream.
    Tries OpenCV VideoCapture first; if unavailable, falls back to raw HTTP multipart parsing.
    """
    def __init__(self, stream_url: str):
        self.stream_url = stream_url
        self.cap: Optional[cv2.VideoCapture] = None
        self.http_response = None
        self.http_bytes = b""
        self.mode = "opencv"  # 'opencv' | 'http_multipart'
        self.is_connected = False

    def connect(self) -> bool:
        self.close()
        logger.info(f"Connecting to ESP32-CAM stream at: {self.stream_url} ...")

        # 1. Try OpenCV VideoCapture
        try:
            self.cap = cv2.VideoCapture(self.stream_url)
            # Short probe read
            if self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret and frame is not None and frame.size > 0:
                    self.is_connected = True
                    self.mode = "opencv"
                    logger.info(f"Connected to ESP32 stream via OpenCV VideoCapture (resolution: {frame.shape[1]}x{frame.shape[0]}).")
                    return True
        except Exception as e:
            logger.debug(f"OpenCV stream connect probe failed: {e}")

        # 2. Fallback to HTTP multipart MJPEG stream reader
        try:
            logger.info("OpenCV direct stream failed or timed out. Falling back to HTTP multipart parser...")
            req = urllib.request.Request(
                self.stream_url,
                headers={"User-Agent": "SentryWing-ESP32-Bridge/2.0"}
            )
            self.http_response = urllib.request.urlopen(req, timeout=5.0)
            self.is_connected = True
            self.mode = "http_multipart"
            self.http_bytes = b""
            logger.info("Connected to ESP32 stream via HTTP multipart parser.")
            return True
        except Exception as err:
            logger.warning(f"Unable to connect to ESP32-CAM stream: {err}")
            self.close()
            return False

    def read_frame(self) -> Optional[np.ndarray]:
        """Reads next BGR image frame from the stream."""
        if not self.is_connected:
            return None

        if self.mode == "opencv" and self.cap:
            try:
                ret, frame = self.cap.read()
                if ret and frame is not None and frame.size > 0:
                    return frame
                else:
                    self.is_connected = False
                    return None
            except Exception:
                self.is_connected = False
                return None

        elif self.mode == "http_multipart" and self.http_response:
            try:
                # Read chunks until complete JPEG between SOI (0xffd8) and EOI (0xffd9)
                while True:
                    chunk = self.http_response.read(4096)
                    if not chunk:
                        self.is_connected = False
                        return None
                    self.http_bytes += chunk
                    a = self.http_bytes.find(b"\xff\xd8")
                    b = self.http_bytes.find(b"\xff\xd9")
                    if a != -1 and b != -1 and b > a:
                        jpg = self.http_bytes[a : b + 2]
                        self.http_bytes = self.http_bytes[b + 2 :]
                        frame = cv2.imdecode(np.frombuffer(jpg, dtype=np.uint8), cv2.IMREAD_COLOR)
                        if frame is not None:
                            return frame
            except Exception:
                self.is_connected = False
                return None

        return None

    def close(self):
        self.is_connected = False
        if self.cap:
            try: self.cap.release()
            except Exception: pass
            self.cap = None
        if self.http_response:
            try: self.http_response.close()
            except Exception: pass
            self.http_response = None
        self.http_bytes = b""


# =============================================================================
# MAIN BRIDGE SERVICE
# =============================================================================
class ESP32Bridge:
    def __init__(self, config: BridgeConfig):
        self.cfg = config
        self.reader = ESP32StreamReader(self.cfg.esp32_stream_url)
        self.tracker = None
        if self.cfg.enable_detection and DETECTION_AVAILABLE:
            self.tracker = TargetTracker()

        # Telemetry stats
        self.frames_sent = 0
        self.frames_in_second = 0
        self.last_fps_calc_time = time.time()
        self.current_fps = 0.0
        self.ws_connected = False
        self.esp32_connected = False
        self.last_status_log_time = 0.0

    def format_payload(
        self,
        frame_b64: str,
        lock_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Builds payload conforming strictly to the dashboard's live feed contract:
        Supports both top-level keys { source_id, frame, lat, lng, timestamp, locked, bbox, direction, dx, dy, predicted, attributes }
        and nested { type, unix_timestamp, location, uploader, lock } for full viewer compatibility.
        """
        now = time.time()
        now_iso = datetime.now(timezone.utc).isoformat()

        is_locked = bool(lock_data and lock_data.get("locked"))

        payload = {
            # Standard type tag
            "type": "live_feed_frame",
            "source_id": self.cfg.source_id,
            "timestamp": now_iso,
            "unix_timestamp": round(now, 4),
            "frame": frame_b64,
            "lat": self.cfg.lat,
            "lng": self.cfg.lng,

            # Direct flat lock fields (exact contract requested)
            "locked": is_locked,
            "bbox": lock_data.get("bbox") if is_locked else None,
            "direction": lock_data.get("direction") if is_locked else None,
            "dx": lock_data.get("dx") if is_locked else None,
            "dy": lock_data.get("dy") if is_locked else None,
            "predicted": lock_data.get("predicted") if is_locked else None,
            "attributes": lock_data.get("attributes") if is_locked else None,

            # Nested fields consumed by frontend LiveFeedViewer.jsx
            "location": {
                "lat": self.cfg.lat,
                "lng": self.cfg.lng,
                "name": self.cfg.location_name,
                "accuracy": 5
            },
            "uploader": {
                "id": self.cfg.source_id,
                "name": f"ESP32 Sentry ({self.cfg.source_id})"
            },
            "lock": lock_data if is_locked else None
        }
        return payload

    async def run(self):
        import websockets

        logger.info("=" * 70)
        logger.info("  SentryWing ESP32-CAM MJPEG to WebSocket Bridge")
        logger.info(f"  ESP32 Stream URL : {self.cfg.esp32_stream_url}")
        logger.info(f"  Dashboard WS URL : {self.cfg.dashboard_ws_url}")
        logger.info(f"  Source ID        : {self.cfg.source_id}")
        logger.info(f"  Fixed Location   : {self.cfg.lat}° N, {self.cfg.lng}° E ({self.cfg.location_name})")
        logger.info(f"  Detection Mode   : {'ENABLED (Neural YOLO + Tracker)' if (self.cfg.enable_detection and DETECTION_AVAILABLE) else 'RAW VIDEO ONLY'}")
        logger.info("=" * 70)

        esp32_reconnect_delay = 1.0
        ws_reconnect_delay = 1.0

        while True:
            # 1. Ensure connected to ESP32 stream
            if not self.reader.is_connected:
                self.esp32_connected = False
                success = self.reader.connect()
                if not success:
                    self.log_status()
                    await asyncio.sleep(esp32_reconnect_delay)
                    esp32_reconnect_delay = min(15.0, esp32_reconnect_delay * 1.5)
                    continue
                else:
                    esp32_reconnect_delay = 1.0
                    self.esp32_connected = True

            # 2. Connect to Dashboard WebSocket
            ws = None
            try:
                logger.info(f"Connecting to Dashboard WebSocket at: {self.cfg.dashboard_ws_url} ...")
                ws = await asyncio.wait_for(
                    websockets.connect(self.cfg.dashboard_ws_url, ping_interval=20, ping_timeout=10),
                    timeout=4.0
                )
                self.ws_connected = True
                ws_reconnect_delay = 1.0
                logger.info(f"Successfully connected to Dashboard WebSocket: {self.cfg.dashboard_ws_url}")
            except Exception as err:
                self.ws_connected = False
                logger.warning(f"Failed to connect to Dashboard WebSocket '{self.cfg.dashboard_ws_url}': {err} (retry in {ws_reconnect_delay:.1f}s)")
                self.log_status()
                await asyncio.sleep(ws_reconnect_delay)
                ws_reconnect_delay = min(15.0, ws_reconnect_delay * 1.5)
                continue

            # 3. Streaming Loop
            frame_interval = 1.0 / max(1, self.cfg.target_fps)
            last_frame_dispatch = 0.0

            try:
                while self.reader.is_connected and not ws.closed:
                    loop_start = time.time()

                    # Pull next frame from ESP32
                    frame = self.reader.read_frame()
                    if frame is None:
                        logger.warning("ESP32 frame read returned None (stream dropped). Reconnecting...")
                        self.esp32_connected = False
                        break

                    self.esp32_connected = True

                    # Throttle to target FPS
                    now = time.time()
                    if now - last_frame_dispatch < (frame_interval * 0.85):
                        await asyncio.sleep(0.01)
                        continue
                    last_frame_dispatch = now

                    # Optional on-bridge Detection & Target Locking
                    lock_data = None
                    frame_h, frame_w = frame.shape[:2]

                    if self.cfg.enable_detection and DETECTION_AVAILABLE and self.tracker:
                        try:
                            detections = run_detection(frame, self.cfg.confidence_threshold)
                            tracking_status, locked_det = self.tracker.update(detections)

                            if tracking_status.locked:
                                attr_dict = None
                                if locked_det is not None:
                                    x1, y1, x2, y2 = locked_det.bbox
                                    px1 = max(0, int(x1 * frame_w))
                                    py1 = max(0, int(y1 * frame_h))
                                    px2 = min(frame_w, int(x2 * frame_w))
                                    py2 = min(frame_h, int(y2 * frame_h))
                                    if px2 > px1 and py2 > py1:
                                        target_crop = frame[py1:py2, px1:px2]
                                        attr_res = run_attributes(target_crop, locked_det.class_name, img_w=frame_w, img_h=frame_h)
                                        attr_dict = attr_res.to_dict() if attr_res else None

                                lock_data = {
                                    "locked": True,
                                    "state": getattr(tracking_status, "state", "LOCKED"),
                                    "target_id": getattr(tracking_status, "target_id", None),
                                    "species": getattr(tracking_status, "target_class", None),
                                    "bbox": getattr(tracking_status, "target_bbox", None),
                                    "center": getattr(tracking_status, "target_center", None),
                                    "dx": getattr(tracking_status, "dx", 0.0),
                                    "dy": getattr(tracking_status, "dy", 0.0),
                                    "direction": getattr(tracking_status, "direction", "CENTERED"),
                                    "predicted": getattr(tracking_status, "predicted", False),
                                    "lost_count": getattr(tracking_status, "lost_count", 0),
                                    "attributes": attr_dict
                                }
                        except Exception as det_err:
                            logger.debug(f"Bridge detection pass error: {det_err}")

                    # Encode to JPEG and base64
                    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    frame_b64 = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

                    # Package message
                    payload = self.format_payload(frame_b64, lock_data)
                    payload_str = json.dumps(payload)

                    # Push over WebSocket
                    await ws.send(payload_str)
                    self.frames_sent += 1
                    self.frames_in_second += 1

                    # Update FPS calculation
                    t_now = time.time()
                    if t_now - self.last_fps_calc_time >= 1.0:
                        self.current_fps = round(self.frames_in_second / (t_now - self.last_fps_calc_time), 1)
                        self.frames_in_second = 0
                        self.last_fps_calc_time = t_now

                    # Periodic status heartbeat
                    if t_now - self.last_status_log_time >= 4.0:
                        self.log_status()
                        self.last_status_log_time = t_now

                    # Yield control to event loop
                    await asyncio.sleep(0.005)

            except (websockets.ConnectionClosed, websockets.WebSocketException) as ws_err:
                logger.warning(f"Dashboard WebSocket disconnected: {ws_err}")
                self.ws_connected = False
            except Exception as err:
                logger.warning(f"Bridge loop exception: {err}")
            finally:
                if ws:
                    try: await ws.close()
                    except Exception: pass
                self.ws_connected = False

            self.log_status()
            await asyncio.sleep(1.0)

    def log_status(self):
        """Prints high-visibility status heartbeat."""
        esp32_str = "YES (ONLINE)" if self.esp32_connected else "NO (DISCONNECTED)"
        ws_str = "YES (ONLINE)" if self.ws_connected else "NO (DISCONNECTED)"
        logger.info(
            f"[HEARTBEAT] ESP32-CAM: {esp32_str} | Dashboard WS: {ws_str} | "
            f"Rate: {self.current_fps} FPS | Total Frames: {self.frames_sent}"
        )


# =============================================================================
# CLI ENTRY POINT
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="SentryWing ESP32-CAM to WebSocket Live Feed Bridge")
    parser.add_argument("--stream-url", default=None, help="ESP32-CAM MJPEG HTTP stream URL (e.g. http://192.168.1.50:81/stream)")
    parser.add_argument("--dashboard-ws", default=None, help="Dashboard WebSocket URL (e.g. ws://127.0.0.1:8000/ws/live-feed)")
    parser.add_argument("--source-id", default=None, help="Identifier for this camera unit (e.g. esp32-cam-1)")
    parser.add_argument("--lat", type=float, default=None, help="Fixed latitude coordinate for this ESP32 post")
    parser.add_argument("--lng", type=float, default=None, help="Fixed longitude coordinate for this ESP32 post")
    parser.add_argument("--location-name", default=None, help="Descriptive place/sector name")
    parser.add_argument("--fps", type=int, default=None, help="Target transmission frame rate (default: 12)")
    parser.add_argument("--detect", dest="detect", action="store_true", default=None, help="Run neural detection on bridge before pushing")
    parser.add_argument("--raw", dest="detect", action="store_false", help="Disable neural detection, push raw video only")

    args = parser.parse_args()
    config = BridgeConfig(args)

    if config.enable_detection:
        try_load_detector()

    bridge = ESP32Bridge(config)

    try:
        asyncio.run(bridge.run())
    except KeyboardInterrupt:
        logger.info("Bridge stopped by user.")


if __name__ == "__main__":
    main()
