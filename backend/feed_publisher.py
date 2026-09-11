"""
Feed Publisher Module for SentryWing Wildlife Intelligence.
Pushes current frame + device geolocation + timestamp + target lock/bbox data
to an external WebSocket endpoint (for Admin/Vet Live Feed Viewer) and broadcasts
to local /ws/live-feed subscribers.
"""

import asyncio
import base64
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Set
import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from config import config

logger = logging.getLogger("feed_publisher")


class FeedPublisher:
    """
    Manages publishing live video feed and tracking metadata:
    1. Direct WebSocket client link to external service at config.PUBLISH_TARGET_URL.
    2. Local WebSocket broadcast relay on /ws/live-feed for downstream subscribers.
    """
    def __init__(self):
        self.target_url: str = config.PUBLISH_TARGET_URL
        self.enabled: bool = config.PUBLISH_FEED_ENABLED
        self.local_subscribers: Set[WebSocket] = set()
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=20)
        self._worker_task: Optional[asyncio.Task] = None
        self._external_ws = None
        self._is_running: bool = False
        self.published_count: int = 0
        self.last_published_time: float = 0.0

    def start(self):
        """Starts background publishing worker if not already running."""
        if not self._is_running:
            self._is_running = True
            self._worker_task = asyncio.create_task(self._publisher_loop())
            logger.info("FeedPublisher background worker started.")

    def stop(self):
        self._is_running = False
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()

    def set_target_url(self, url: str):
        """Updates external target URL dynamically."""
        self.target_url = url.strip()
        logger.info(f"FeedPublisher target URL updated to: '{self.target_url}'")

    def set_enabled(self, enabled: bool):
        self.enabled = enabled
        logger.info(f"FeedPublisher enabled set to: {self.enabled}")

    # =========================================================================
    # LOCAL SUBSCRIBER MANAGEMENT (/ws/live-feed)
    # =========================================================================

    async def connect_local_subscriber(self, websocket: WebSocket):
        await websocket.accept()
        self.local_subscribers.add(websocket)
        logger.info(f"Local live feed subscriber connected. Total: {len(self.local_subscribers)}")
        # Send greeting / handshake status
        await websocket.send_json({
            "type": "live_feed_init",
            "status": "connected",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "target_url": self.target_url,
            "feed_active": True
        })

    def disconnect_local_subscriber(self, websocket: WebSocket):
        self.local_subscribers.discard(websocket)
        logger.info(f"Local live feed subscriber disconnected. Remaining: {len(self.local_subscribers)}")

    # =========================================================================
    # FRAME ENQUEUE & DISPATCH
    # =========================================================================

    async def publish_frame(
        self,
        frame_bytes: bytes,
        location: Dict[str, Any],
        tracking_status: Optional[Any] = None,
        attribute_result: Optional[Any] = None,
        uploader_info: Optional[Dict[str, Any]] = None,
        dosage_result: Optional[Any] = None
    ):
        """
        Enqueues frame and metadata for publication.
        Always includes raw frame + location + timestamp.
        Includes lock/bbox/attribute/dosage data only when a target is actively locked.
        """
        # Ensure worker is running
        if not self._is_running:
            self.start()

        now_ts = time.time()
        now_iso = datetime.now(timezone.utc).isoformat()

        # Build lock data (included ONLY when target is currently locked)
        lock_data = None
        if tracking_status is not None and getattr(tracking_status, "locked", False):
            attr_dict = attribute_result.to_dict() if attribute_result and hasattr(attribute_result, "to_dict") else None
            dosage_dict = dosage_result.to_dict() if dosage_result and hasattr(dosage_result, "to_dict") else (
                dosage_result if isinstance(dosage_result, dict) else None
            )
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
                "attributes": attr_dict,
                "dosage": dosage_dict
            }

        # Encode JPEG frame to base64 string
        frame_b64 = f"data:image/jpeg;base64,{base64.b64encode(frame_bytes).decode('utf-8')}"

        payload = {
            "type": "live_feed_frame",
            "timestamp": now_iso,
            "unix_timestamp": round(now_ts, 4),
            "location": {
                "lat": location.get("lat", 29.5312),
                "lng": location.get("lng", 78.7744),
                "name": location.get("location_name") or location.get("name") or "Corbett Sector 4 Patrol",
                "accuracy": location.get("accuracy")
            },
            "uploader": uploader_info or {
                "id": location.get("uploader_id", "scout_01"),
                "name": location.get("uploader_name", "Patrol Ranger")
            },
            "frame": frame_b64,
            "lock": lock_data
        }

        # Drop oldest frame if queue is full to prevent lag
        if self._queue.full():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass

        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    async def broadcast_payload(self, payload: Dict[str, Any], exclude: Optional[WebSocket] = None):
        """
        Directly and immediately broadcasts a pre-packaged frame payload (e.g. from ESP32 bridge)
        to all connected /ws/live-feed subscribers and the external target without queue delay.
        """
        payload_str = json.dumps(payload)
        dead = set()
        for ws in list(self.local_subscribers):
            if ws == exclude:
                continue
            try:
                await ws.send_text(payload_str)
            except Exception:
                dead.add(ws)
        for d in dead:
            self.local_subscribers.discard(d)

        if self.enabled and self.target_url:
            try:
                await self._send_to_external_target(payload_str)
            except Exception:
                pass

        self.published_count += 1
        self.last_published_time = time.time()

    # =========================================================================
    # ASYNC WORKER LOOP
    # =========================================================================

    async def _publisher_loop(self):
        """Worker task processing queued frames, broadcasting locally and upstream."""
        import websockets

        while self._is_running:
            try:
                payload = await self._queue.get()
                payload_str = json.dumps(payload)

                # 1. Broadcast to local /ws/live-feed subscribers
                if self.local_subscribers:
                    dead_subscribers = set()
                    for ws in list(self.local_subscribers):
                        try:
                            await ws.send_text(payload_str)
                        except Exception:
                            dead_subscribers.add(ws)
                    for dead in dead_subscribers:
                        self.local_subscribers.discard(dead)

                # 2. Push to external WebSocket endpoint if configured and enabled
                if self.enabled and self.target_url:
                    await self._send_to_external_target(payload_str)

                self.published_count += 1
                self.last_published_time = time.time()
                self._queue.task_done()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Error in FeedPublisher worker loop: {e}")
                await asyncio.sleep(0.05)

    async def _send_to_external_target(self, payload_str: str):
        """Maintains persistent connection to external endpoint and sends payload with backoff protection."""
        import websockets

        now = time.time()
        if self._external_ws is None or self._external_ws.closed:
            # Respect reconnect cooldown to prevent blocking the worker loop
            if now < getattr(self, "_next_reconnect_time", 0.0):
                return

            try:
                logger.info(f"Connecting to external live feed target: {self.target_url}...")
                self._external_ws = await asyncio.wait_for(
                    websockets.connect(self.target_url, ping_interval=20, ping_timeout=10),
                    timeout=2.0
                )
                self._reconnect_delay = 1.0
                logger.info(f"Successfully connected to external feed target: {self.target_url}")
            except Exception as err:
                curr_delay = getattr(self, "_reconnect_delay", 1.0)
                self._next_reconnect_time = now + curr_delay
                self._reconnect_delay = min(15.0, curr_delay * 1.5)
                logger.warning(f"Failed to connect to external feed target '{self.target_url}': {err} (next retry in {curr_delay:.1f}s)")
                self._external_ws = None
                return

        try:
            await self._external_ws.send(payload_str)
        except Exception as send_err:
            logger.warning(f"Failed to send frame to external target: {send_err}")
            try:
                await self._external_ws.close()
            except Exception:
                pass
            self._external_ws = None
            self._next_reconnect_time = time.time() + 2.0


# Global singleton instance
feed_publisher = FeedPublisher()
