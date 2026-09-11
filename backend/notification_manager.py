"""
Real-time notification fan-out broadcaster for SentryWing.
Broadcasts new animal sighting alerts over WebSockets to Veterinarians and Forest Officers.
"""

import logging
import asyncio
from typing import Set
from fastapi import WebSocket

logger = logging.getLogger("notifications")

class NotificationManager:
    def __init__(self):
        self._active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._active_connections.add(websocket)
        logger.info(f"Notification subscriber connected. Total active: {len(self._active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self._active_connections:
            self._active_connections.remove(websocket)
            logger.info(f"Notification subscriber disconnected. Remaining: {len(self._active_connections)}")

    async def broadcast(self, notification: dict):
        if not self._active_connections:
            logger.info(f"No active notification subscribers to receive alert: {notification.get('title')}")
            return

        payload = {
            "type": "new_notification",
            "notification": notification
        }
        
        dead_connections = []
        for ws in self._active_connections:
            try:
                await ws.send_json(payload)
            except Exception as e:
                logger.warning(f"Failed to send notification to socket: {e}")
                dead_connections.append(ws)

        for ws in dead_connections:
            self.disconnect(ws)

notification_manager = NotificationManager()
