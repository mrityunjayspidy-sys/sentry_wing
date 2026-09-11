"""
WebSocket streaming integration test.
Tests /ws/stream (telemetry, frame processing, publish mode) and /ws/live-feed subscriber socket.
"""

import cv2
import numpy as np
import json
from fastapi.testclient import TestClient
from main import app


def test_ws_communication():
    print("Testing WebSocket stream endpoint with TestClient...")
    client = TestClient(app)
    
    # 1. Check health REST endpoint
    health_resp = client.get("/health")
    assert health_resp.status_code == 200
    print(f"  Health check response: {health_resp.json()}")

    # 2. Check /api/status publishing details
    status_resp = client.get("/api/status")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert "publishing" in status_data
    print(f"  Publishing status config: {status_data['publishing']}")

    # 3. Open Live Stream WebSocket (/ws/stream)
    with client.websocket_connect("/ws/stream") as websocket:
        # (a) Send Ping
        websocket.send_text(json.dumps({"type": "ping"}))
        pong = websocket.receive_json()
        assert pong["type"] == "pong"
        assert "time" in pong
        print(f"  Received Pong: {pong}")

        # (b) Test Publish Mode configuration
        websocket.send_text(json.dumps({
            "type": "set_publish_mode",
            "enabled": True,
            "url": "ws://localhost:9000/ws/external-feed"
        }))
        ack = websocket.receive_json()
        assert ack["type"] == "publish_mode_ack"
        assert ack["enabled"] is True
        assert ack["target_url"] == "ws://localhost:9000/ws/external-feed"
        print(f"  Publish Mode Acknowledged: {ack}")

        # (b2) Test Session and Location update commands
        websocket.send_text(json.dumps({
            "type": "init_session",
            "uploader_id": "scout_99",
            "uploader_name": "Ranger Arjun",
            "location": {"lat": 29.54, "lng": 78.80, "name": "Corbett Gate 3"}
        }))
        session_ack = websocket.receive_json()
        assert session_ack["type"] == "session_ack"
        assert session_ack["session"]["uploader_id"] == "scout_99"
        print(f"  Session Init Acknowledged: {session_ack['session']}")

        websocket.send_text(json.dumps({
            "type": "update_location",
            "location": {"lat": 29.551, "lng": 78.812, "name": "Corbett Waterhole Ridge"}
        }))
        loc_ack = websocket.receive_json()
        assert loc_ack["type"] == "location_ack"
        assert loc_ack["location"]["lat"] == 29.551
        assert loc_ack["location"]["location_name"] == "Corbett Waterhole Ridge"
        print(f"  Location Update Acknowledged: {loc_ack['location']}")

        # (c) Send JPEG Frame
        dummy_img = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.circle(dummy_img, (320, 240), 50, (0, 255, 0), -1)
        _, jpeg_bytes = cv2.imencode(".jpg", dummy_img, [cv2.IMWRITE_JPEG_QUALITY, 80])

        websocket.send_bytes(jpeg_bytes.tobytes())
        telemetry = websocket.receive_json()

        assert telemetry["type"] == "telemetry"
        assert "detections" in telemetry
        assert "tracking" in telemetry
        assert "hardware_command" in telemetry["tracking"]
        assert "predicted" in telemetry["tracking"]
        assert "bbox" in telemetry["tracking"]
        print(f"  Received Telemetry: locked={telemetry['tracking']['locked']}, predicted={telemetry['tracking']['predicted']}, state={telemetry['tracking']['state']}, direction={telemetry['tracking']['direction']}")

        # (d) Test Manual Unlock
        websocket.send_text(json.dumps({"type": "unlock"}))
        websocket.send_bytes(jpeg_bytes.tobytes())
        telemetry2 = websocket.receive_json()
        assert telemetry2["tracking"]["state"] == "SEARCHING"
        assert telemetry2["tracking"]["predicted"] is False
        print(f"  After Unlock: tracking state={telemetry2['tracking']['state']}")

    # 4. Open Live Feed Subscriber WebSocket (/ws/live-feed)
    with client.websocket_connect("/ws/live-feed") as live_ws:
        init_msg = live_ws.receive_json()
        assert init_msg["type"] == "live_feed_init"
        assert init_msg["status"] == "connected"
        print(f"  /ws/live-feed subscriber greeting received: {init_msg}")

    print("\n[PASS] All WebSocket stream & live-feed integration tests completed successfully.")


if __name__ == "__main__":
    test_ws_communication()
