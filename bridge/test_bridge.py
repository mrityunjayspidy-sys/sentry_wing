"""
Integration tests for ESP32 Bridge:
  1. Payload schema validation (flat contract + nested viewer compatibility).
  2. Live WebSocket relay test: verifies that pushed bridge frames arrive at the /ws/live-feed viewer.
"""

import sys
import json
import base64
import time
from pathlib import Path

import cv2
import numpy as np

# Add backend and bridge to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(SCRIPT_DIR))

from fastapi.testclient import TestClient
from main import app
from esp32_bridge import BridgeConfig, ESP32Bridge


def test_bridge_payload_schema():
    print("Testing ESP32Bridge payload formatting...")
    cfg = BridgeConfig()
    cfg.source_id = "esp32-cam-test"
    cfg.lat = 29.5312
    cfg.lng = 78.7744
    cfg.location_name = "Corbett Sector 4 Sentry"

    bridge = ESP32Bridge(cfg)

    # 1. Unlocked frame payload test
    raw_payload = bridge.format_payload("data:image/jpeg;base64,dummy", lock_data=None)

    # Check flat schema (contract from prompt)
    assert raw_payload["source_id"] == "esp32-cam-test"
    assert raw_payload["frame"] == "data:image/jpeg;base64,dummy"
    assert raw_payload["lat"] == 29.5312
    assert raw_payload["lng"] == 78.7744
    assert "timestamp" in raw_payload
    assert raw_payload["locked"] is False
    assert raw_payload["bbox"] is None
    assert raw_payload["direction"] is None
    assert raw_payload["dx"] is None
    assert raw_payload["dy"] is None
    assert raw_payload["predicted"] is None
    assert raw_payload["attributes"] is None

    # Check nested fields for LiveFeedViewer.jsx
    assert raw_payload["location"]["name"] == "Corbett Sector 4 Sentry"
    assert raw_payload["lock"] is None
    print("  [PASS] Unlocked payload conforms to exact flat schema & nested viewer schema.")

    # 2. Locked frame payload test
    sample_lock = {
        "locked": True,
        "state": "LOCKED",
        "target_id": 42,
        "species": "tiger",
        "bbox": [0.2, 0.2, 0.6, 0.6],
        "center": (0.4, 0.4),
        "dx": 0.05,
        "dy": -0.02,
        "direction": "RIGHT",
        "predicted": False,
        "attributes": {"vitality_status": "Active / Alert", "estimated_weight_kg": 185}
    }
    locked_payload = bridge.format_payload("data:image/jpeg;base64,dummy2", lock_data=sample_lock)

    assert locked_payload["locked"] is True
    assert locked_payload["bbox"] == [0.2, 0.2, 0.6, 0.6]
    assert locked_payload["direction"] == "RIGHT"
    assert locked_payload["dx"] == 0.05
    assert locked_payload["predicted"] is False
    assert locked_payload["attributes"]["vitality_status"] == "Active / Alert"
    assert locked_payload["lock"]["species"] == "tiger"
    print("  [PASS] Locked payload correctly formats detection & biometrics data.")


def test_live_feed_relay():
    print("Testing /ws/live-feed relay from bridge to subscriber...")
    client = TestClient(app)

    # Open subscriber connection (representing Admin/Vet Live Feed Viewer)
    with client.websocket_connect("/ws/live-feed") as viewer_ws:
        init_msg = viewer_ws.receive_json()
        assert init_msg["type"] == "live_feed_init"

        # Open publisher connection (representing ESP32 bridge)
        with client.websocket_connect("/ws/live-feed") as bridge_ws:
            bridge_init = bridge_ws.receive_json()
            assert bridge_init["type"] == "live_feed_init"

            test_payload = {
                "type": "live_feed_frame",
                "source_id": "esp32-cam-1",
                "frame": "data:image/jpeg;base64,sample_jpeg_bytes",
                "lat": 29.5312,
                "lng": 78.7744,
                "timestamp": "2026-09-11T04:25:30.123Z",
                "locked": True,
                "bbox": [0.1, 0.1, 0.5, 0.5],
                "direction": "CENTERED",
                "dx": 0.0,
                "dy": 0.0,
                "predicted": False,
                "attributes": None
            }
            bridge_ws.send_text(json.dumps(test_payload))

            # Viewer receives the relayed frame
            relayed_frame = viewer_ws.receive_json()
            assert relayed_frame["type"] == "live_feed_frame"
            assert relayed_frame["source_id"] == "esp32-cam-1"
            assert relayed_frame["frame"] == "data:image/jpeg;base64,sample_jpeg_bytes"
            assert relayed_frame["lat"] == 29.5312
            assert relayed_frame["locked"] is True
            assert relayed_frame["location"]["lat"] == 29.5312
            assert relayed_frame["lock"]["locked"] is True
            assert relayed_frame["lock"]["bbox"] == [0.1, 0.1, 0.5, 0.5]
            print(f"  [PASS] Viewer successfully received relayed ESP32 frame: source_id={relayed_frame['source_id']}, locked={relayed_frame['locked']}")


if __name__ == "__main__":
    test_bridge_payload_schema()
    test_live_feed_relay()
    print("\n[ALL TESTS PASSED] ESP32 bridge meets all specifications.\n")
