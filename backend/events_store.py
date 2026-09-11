"""
Thread-safe event store and notification manager for SentryWing.
Persists detection events, notifications, and users to JSON files.
"""

import os
import json
import time
import uuid
import logging
from threading import Lock
from typing import List, Dict, Any, Optional

logger = logging.getLogger("events_store")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
EVENTS_FILE = os.path.join(DATA_DIR, "detection_events.json")
NOTIFICATIONS_FILE = os.path.join(DATA_DIR, "notifications.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")

# Species urgency levels for notification fan-out
URGENCY_MAP = {
    "tiger": "CRITICAL",
    "lion": "CRITICAL",
    "leopard": "CRITICAL",
    "bear": "CRITICAL",
    "elephant": "WARNING",
    "hyena": "WARNING",
    "cheetah": "WARNING",
    "fox": "INFO"
}

INITIAL_USERS = [
    {
        "id": "ranger_maya",
        "username": "ranger_maya",
        "name": "Ranger Maya Patil",
        "role": "normal_user",
        "badge": "Scout Sector 4",
        "email": "maya.patil@forest.gov.in",
        "created_at": "2026-09-01T08:00:00Z",
        "last_active": "Just now"
    },
    {
        "id": "dr_rajiv",
        "username": "dr_rajiv",
        "name": "Dr. Rajiv Sen",
        "role": "veterinarian",
        "badge": "Chief Wildlife Medical Officer",
        "email": "dr.rajiv.sen@vetcorp.org",
        "created_at": "2026-08-15T09:30:00Z",
        "last_active": "Active 5m ago"
    },
    {
        "id": "officer_sharma",
        "username": "officer_sharma",
        "name": "Officer K. Sharma",
        "role": "admin",
        "badge": "Divisional Forest Officer (DFO)",
        "email": "k.sharma@forest.gov.in",
        "created_at": "2026-07-20T10:00:00Z",
        "last_active": "Active now"
    }
]

INITIAL_EVENTS = []
_OLD_EVENTS = [
    {
        "id": "evt_seed_001",
        "user_id": "ranger_maya",
        "username": "Ranger Maya Patil",
        "user_role": "normal_user",
        "species": "tiger",
        "confidence": 0.88,
        "bbox": [0.22, 0.31, 0.74, 0.85],
        "location": {
            "lat": 29.5312,
            "lng": 78.7744,
            "address": "Waterhole Trail 3, Zone B",
            "sector": "Corbett Sector B"
        },
        "attributes": {
            "target": "tiger",
            "age": "adult (4–10 years)",
            "sex": "Female",
            "body_size": "Large (160–250 kg)",
            "behaviour": "walking / traversing",
            "health": "Normal Vitality / Active",
            "anomalies": "No visible injury",
            "urgency": "CRITICAL"
        },
        "source": "live_camera",
        "thumbnail": "",
        "timestamp": "2026-09-10T19:42:15Z"
    },
    {
        "id": "evt_seed_002",
        "user_id": "ranger_maya",
        "username": "Ranger Maya Patil",
        "user_role": "normal_user",
        "species": "elephant",
        "confidence": 0.92,
        "bbox": [0.15, 0.20, 0.82, 0.90],
        "location": {
            "lat": 29.5450,
            "lng": 78.7910,
            "address": "Ramganga Riverbank Clearing",
            "sector": "Corbett Sector A"
        },
        "attributes": {
            "target": "elephant",
            "age": "adult (15–35 years)",
            "sex": "Male",
            "body_size": "Very Large (3000–5000 kg)",
            "behaviour": "foraging / grazing",
            "health": "Normal Vitality",
            "anomalies": "Tusk intact",
            "urgency": "WARNING"
        },
        "source": "photo_upload",
        "thumbnail": "",
        "timestamp": "2026-09-10T18:15:30Z"
    },
    {
        "id": "evt_seed_003",
        "user_id": "dr_rajiv",
        "username": "Dr. Rajiv Sen",
        "user_role": "veterinarian",
        "species": "leopard",
        "confidence": 0.85,
        "bbox": [0.35, 0.28, 0.68, 0.72],
        "location": {
            "lat": 29.5201,
            "lng": 78.7623,
            "address": "Ridge Rocks, Watchtower 2",
            "sector": "Corbett Sector C"
        },
        "attributes": {
            "target": "leopard",
            "age": "subadult (2–4 years)",
            "sex": "Male",
            "body_size": "Medium (50–70 kg)",
            "behaviour": "resting on branch",
            "health": "Normal Vitality",
            "anomalies": "Clear visual field",
            "urgency": "CRITICAL"
        },
        "source": "video_upload",
        "thumbnail": "",
        "timestamp": "2026-09-10T16:05:10Z"
    }
]

INITIAL_NOTIFICATIONS = []
_OLD_NOTIFS = [
    {
        "id": "notif_seed_001",
        "event_id": "evt_seed_001",
        "species": "tiger",
        "urgency": "CRITICAL",
        "title": "CRITICAL APEX ALERT: TIGER Sighted",
        "message": "Adult female tiger confirmed at Waterhole Trail 3 by Ranger Maya.",
        "location": {
            "lat": 29.5312,
            "lng": 78.7744,
            "address": "Waterhole Trail 3, Zone B",
            "sector": "Corbett Sector B"
        },
        "read": False,
        "timestamp": "2026-09-10T19:42:16Z"
    },
    {
        "id": "notif_seed_002",
        "event_id": "evt_seed_002",
        "species": "elephant",
        "urgency": "WARNING",
        "title": "HERD CROSSING ALERT: ELEPHANT Sighted",
        "message": "Solitary adult male spotted near Ramganga Riverbank Clearing.",
        "location": {
            "lat": 29.5450,
            "lng": 78.7910,
            "address": "Ramganga Riverbank Clearing",
            "sector": "Corbett Sector A"
        },
        "read": False,
        "timestamp": "2026-09-10T18:15:31Z"
    }
]


class EventsStore:
    def __init__(self):
        self._lock = Lock()
        os.makedirs(DATA_DIR, exist_ok=True)
        self._events = self._load_json(EVENTS_FILE, INITIAL_EVENTS)
        self._notifications = self._load_json(NOTIFICATIONS_FILE, INITIAL_NOTIFICATIONS)
        self._users = self._load_json(USERS_FILE, INITIAL_USERS)

    def _load_json(self, filepath: str, default_data: Any) -> Any:
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error reading {filepath}: {e}")
        # Initialize default
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=2)
        return default_data

    def _save_file(self, filepath: str, data: Any):
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Error writing {filepath}: {e}")

    def add_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            if "id" not in event or not event["id"]:
                event["id"] = f"evt_{uuid.uuid4().hex[:10]}"
            if "timestamp" not in event or not event["timestamp"]:
                event["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            # Prepend to events
            self._events.insert(0, event)
            self._save_file(EVENTS_FILE, self._events)

            # Generate automated notification
            species = event.get("species", "unknown").lower()
            urgency = URGENCY_MAP.get(species, "INFO")
            
            # If bio-attributes show anomaly, elevate urgency
            attrs = event.get("attributes", {})
            if attrs.get("anomalies") and "injury" in attrs.get("anomalies", "").lower():
                urgency = "CRITICAL"

            loc = event.get("location", {})
            loc_label = loc.get("address") or loc.get("sector") or f"{loc.get('lat', '')}, {loc.get('lng', '')}"
            
            notif = {
                "id": f"notif_{uuid.uuid4().hex[:10]}",
                "event_id": event["id"],
                "species": species,
                "urgency": urgency,
                "title": f"{urgency} ALERT: {species.upper()} Sighted",
                "message": f"Distinct {species} detected by {event.get('username', 'Observer')} at {loc_label}.",
                "location": loc,
                "attributes": attrs,
                "read": False,
                "timestamp": event["timestamp"]
            }
            self._notifications.insert(0, notif)
            self._save_file(NOTIFICATIONS_FILE, self._notifications)
            
            return event, notif

    def get_events(
        self,
        user_id: Optional[str] = None,
        species: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        with self._lock:
            res = self._events
            if user_id:
                res = [e for e in res if e.get("user_id") == user_id]
            if species:
                res = [e for e in res if e.get("species", "").lower() == species.lower()]
            return res[:limit]

    def get_event_by_id(self, event_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for e in self._events:
                if e.get("id") == event_id:
                    return e
            return None

    def delete_event(self, event_id: str) -> bool:
        with self._lock:
            initial_len = len(self._events)
            self._events = [e for e in self._events if e.get("id") != event_id]
            if len(self._events) != initial_len:
                self._save_file(EVENTS_FILE, self._events)
                return True
            return False

    def get_notifications(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return self._notifications[:limit]

    def mark_notification_read(self, notif_id: str) -> bool:
        with self._lock:
            for n in self._notifications:
                if n.get("id") == notif_id:
                    n["read"] = True
                    self._save_file(NOTIFICATIONS_FILE, self._notifications)
                    return True
            return False

    def get_users(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._users)

    def update_user_role(self, user_id: str, new_role: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for u in self._users:
                if u.get("id") == user_id:
                    u["role"] = new_role
                    self._save_file(USERS_FILE, self._users)
                    return u
            return None

    def add_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            if "id" not in user_data:
                user_data["id"] = f"user_{uuid.uuid4().hex[:6]}"
            if "created_at" not in user_data:
                user_data["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._users.append(user_data)
            self._save_file(USERS_FILE, self._users)
            return user_data


events_store = EventsStore()
