"""
SQLite Database interface for SentryWing.
Tables:
  - users: id, email, password_hash, name, role ('user', 'vet', 'admin'), is_active, created_at
  - detections: id, uploader_id, uploader_name, source_type ('live', 'video', 'photo'), media_ref,
                species, confidence, bbox, attributes, lat, lng, location_name, timestamp,
                status ('new', 'reviewed'), review_note, reviewed_by, reviewed_at
  - notifications: id, recipient_role, detection_id, species, thumbnail, location_name, lat, lng,
                   timestamp, source_type, uploader, read, created_at
"""

import os
import sqlite3
import hashlib
import json
import uuid
import time
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("database")

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "sentrywing.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'vet', 'admin')),
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS detections (
        id TEXT PRIMARY KEY,
        uploader_id TEXT NOT NULL,
        uploader_name TEXT,
        source_type TEXT NOT NULL CHECK(source_type IN ('live', 'video', 'photo')),
        media_ref TEXT,
        species TEXT NOT NULL,
        confidence REAL NOT NULL,
        bbox TEXT,
        attributes TEXT,
        drug_recommendation TEXT,
        dosage_mg REAL,
        dosage_per_kg REAL,
        dosage_confidence REAL,
        dosage_notes TEXT,
        lat REAL,
        lng REAL,
        location_name TEXT,
        timestamp TEXT NOT NULL,
        status TEXT DEFAULT 'new' CHECK(status IN ('new', 'reviewed')),
        review_note TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient_role TEXT NOT NULL,
        detection_id TEXT,
        species TEXT NOT NULL,
        thumbnail TEXT,
        location_name TEXT,
        lat REAL,
        lng REAL,
        timestamp TEXT NOT NULL,
        source_type TEXT NOT NULL,
        uploader TEXT,
        dosage TEXT,
        read INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS model_results (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        source_type TEXT NOT NULL,
        species TEXT NOT NULL,
        confidence REAL NOT NULL,
        bbox_x1 REAL NOT NULL,
        bbox_y1 REAL NOT NULL,
        bbox_x2 REAL NOT NULL,
        bbox_y2 REAL NOT NULL,
        bbox_area REAL NOT NULL,
        aspect_ratio REAL NOT NULL,
        track_id INTEGER,
        is_locked INTEGER DEFAULT 0,
        age TEXT,
        age_range TEXT,
        sex TEXT,
        body_size TEXT,
        weight_range TEXT,
        behaviour TEXT,
        attribute_confidence REAL,
        image_quality_score REAL,
        blur_score REAL,
        is_valid INTEGER DEFAULT 1,
        filter_reason TEXT DEFAULT 'PASSED',
        lat REAL,
        lng REAL,
        location_name TEXT,
        media_ref TEXT,
        model_version TEXT,
        raw_metadata TEXT,
        created_at TEXT NOT NULL
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_model_res_valid_species ON model_results(is_valid, species)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_model_res_timestamp ON model_results(timestamp)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_model_res_confidence ON model_results(confidence)")

    # Dynamic migration for existing SQLite database
    try:
        cursor.execute("PRAGMA table_info(detections)")
        existing_det_cols = {row[1] for row in cursor.fetchall()}
        dosage_cols = [
            ("drug_recommendation", "TEXT"),
            ("dosage_mg", "REAL"),
            ("dosage_per_kg", "REAL"),
            ("dosage_confidence", "REAL"),
            ("dosage_notes", "TEXT"),
        ]
        for col_name, col_type in dosage_cols:
            if col_name not in existing_det_cols:
                cursor.execute(f"ALTER TABLE detections ADD COLUMN {col_name} {col_type}")
                logger.info(f"Migrated detections table: added column {col_name} ({col_type})")

        cursor.execute("PRAGMA table_info(notifications)")
        existing_notif_cols = {row[1] for row in cursor.fetchall()}
        if "dosage" not in existing_notif_cols:
            cursor.execute("ALTER TABLE notifications ADD COLUMN dosage TEXT")
            logger.info("Migrated notifications table: added column dosage (TEXT)")
    except Exception as e:
        logger.warning(f"Schema migration note: {e}")

    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# -----------------------------------------------------------------------------
# USERS
# -----------------------------------------------------------------------------

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def create_user(name: str, email: str, password: str, role: str) -> Dict[str, Any]:
    email = email.strip().lower()
    existing = get_user_by_email(email)
    if existing:
        raise ValueError(f"User with email '{email}' already exists.")

    if role not in ('user', 'vet', 'admin'):
        role = 'user'

    user_id = f"user_{uuid.uuid4().hex[:8]}"
    pwd_hash = hash_password(password)
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO users (id, email, password_hash, name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
        (user_id, email, pwd_hash, name, role, created_at)
    )
    conn.commit()
    conn.close()
    return {
        "id": user_id,
        "email": email,
        "name": name,
        "role": role,
        "is_active": 1,
        "created_at": created_at
    }

def verify_user(email: str, password: str, role: Optional[str] = None) -> Optional[Dict[str, Any]]:
    user = get_user_by_email(email)
    if not user:
        return None
    if user["is_active"] == 0:
        return None
    if user["password_hash"] != hash_password(password):
        return None
    # If a specific role was requested and doesn't match, return None
    if role and user["role"] != role:
        return None
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "is_active": user["is_active"],
        "created_at": user["created_at"]
    }

def get_all_users() -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_user_role(user_id: str, new_role: str) -> bool:
    if new_role not in ('user', 'vet', 'admin'):
        return False
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, user_id))
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated

def toggle_user_active(user_id: str, is_active: int) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET is_active = ? WHERE id = ?", (is_active, user_id))
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated

# -----------------------------------------------------------------------------
# DETECTIONS
# -----------------------------------------------------------------------------

def insert_detection(d: Dict[str, Any]) -> Dict[str, Any]:
    det_id = d.get("id") or f"det_{uuid.uuid4().hex[:10]}"
    timestamp = d.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    bbox_json = json.dumps(d.get("bbox", [])) if isinstance(d.get("bbox"), (list, tuple)) else (d.get("bbox") or "[]")
    attrs_json = json.dumps(d.get("attributes", {})) if isinstance(d.get("attributes"), dict) else (d.get("attributes") or "{}")

    # Extract dosage fields (support both top-level keys and nested 'dosage' dict)
    dosage_obj = d.get("dosage")
    if hasattr(dosage_obj, "to_dict"):
        dosage_obj = dosage_obj.to_dict()
    elif not isinstance(dosage_obj, dict):
        dosage_obj = {}

    drug_rec = d.get("drug_recommendation") or dosage_obj.get("drug_recommendation")
    raw_mg = d.get("dosage_mg") if d.get("dosage_mg") is not None else dosage_obj.get("dosage_mg")
    raw_per_kg = d.get("dosage_per_kg") if d.get("dosage_per_kg") is not None else dosage_obj.get("dosage_per_kg")
    raw_conf = d.get("dosage_confidence") if d.get("dosage_confidence") is not None else (dosage_obj.get("confidence") or dosage_obj.get("dosage_confidence"))
    raw_notes = d.get("dosage_notes") or dosage_obj.get("notes") or dosage_obj.get("dosage_notes")

    dosage_mg = float(raw_mg) if raw_mg is not None else None
    dosage_per_kg = float(raw_per_kg) if raw_per_kg is not None else None
    dosage_conf = float(raw_conf) if raw_conf is not None else None
    dosage_notes = str(raw_notes) if raw_notes is not None else None

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO detections
           (id, uploader_id, uploader_name, source_type, media_ref, species, confidence, bbox, attributes,
            drug_recommendation, dosage_mg, dosage_per_kg, dosage_confidence, dosage_notes,
            lat, lng, location_name, timestamp, status, review_note, reviewed_by, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            det_id,
            d.get("uploader_id", "anonymous"),
            d.get("uploader_name", "Observer"),
            d.get("source_type", "live"),
            d.get("media_ref", ""),
            d.get("species", "unknown").lower(),
            float(d.get("confidence", 0.0)),
            bbox_json,
            attrs_json,
            drug_rec,
            dosage_mg,
            dosage_per_kg,
            dosage_conf,
            dosage_notes,
            float(d.get("lat", 29.5312)) if d.get("lat") is not None else 29.5312,
            float(d.get("lng", 78.7744)) if d.get("lng") is not None else 78.7744,
            d.get("location_name", "Corbett Reserve"),
            timestamp,
            d.get("status", "new"),
            d.get("review_note", ""),
            d.get("reviewed_by", ""),
            d.get("reviewed_at", "")
        )
    )
    conn.commit()
    conn.close()

    d["id"] = det_id
    d["timestamp"] = timestamp
    d["drug_recommendation"] = drug_rec
    d["dosage_mg"] = dosage_mg
    d["dosage_per_kg"] = dosage_per_kg
    d["dosage_confidence"] = dosage_conf
    d["dosage_notes"] = dosage_notes

    if drug_rec or dosage_mg is not None:
        d["dosage"] = {
            "drug_recommendation": drug_rec,
            "dosage_mg": dosage_mg,
            "dosage_per_kg": dosage_per_kg,
            "confidence": dosage_conf,
            "notes": dosage_notes or "",
            "disclaimer": "AI-estimated dosage — verify before administering"
        }

    return d

def get_detections(
    uploader_id: Optional[str] = None,
    species: Optional[str] = None,
    status: Optional[str] = None,
    source_type: Optional[str] = None,
    limit: int = 200
) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()

    query = "SELECT * FROM detections WHERE 1=1"
    params = []

    if uploader_id:
        query += " AND uploader_id = ?"
        params.append(uploader_id)
    if species and species.upper() != "ALL":
        query += " AND LOWER(species) = ?"
        params.append(species.lower())
    if status and status.upper() != "ALL":
        query += " AND status = ?"
        params.append(status.lower())
    if source_type and source_type.upper() != "ALL":
        query += " AND source_type = ?"
        params.append(source_type.lower())

    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        item = dict(r)
        try:
            item["bbox"] = json.loads(item["bbox"]) if item["bbox"] else []
        except Exception:
            item["bbox"] = []
        try:
            item["attributes"] = json.loads(item["attributes"]) if item["attributes"] else {}
        except Exception:
            item["attributes"] = {}

        # Synthesize nested dosage dict for convenience
        if item.get("drug_recommendation") or item.get("dosage_mg") is not None:
            item["dosage"] = {
                "drug_recommendation": item.get("drug_recommendation"),
                "dosage_mg": item.get("dosage_mg"),
                "dosage_per_kg": item.get("dosage_per_kg"),
                "confidence": item.get("dosage_confidence"),
                "notes": item.get("dosage_notes") or "",
                "disclaimer": "AI-estimated dosage — verify before administering"
            }
        results.append(item)
    return results

def get_detection_by_id(det_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM detections WHERE id = ?", (det_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    item = dict(row)
    try:
        item["bbox"] = json.loads(item["bbox"]) if item["bbox"] else []
    except Exception:
        item["bbox"] = []
    try:
        item["attributes"] = json.loads(item["attributes"]) if item["attributes"] else {}
    except Exception:
        item["attributes"] = {}

    if item.get("drug_recommendation") or item.get("dosage_mg") is not None:
        item["dosage"] = {
            "drug_recommendation": item.get("drug_recommendation"),
            "dosage_mg": item.get("dosage_mg"),
            "dosage_per_kg": item.get("dosage_per_kg"),
            "confidence": item.get("dosage_confidence"),
            "notes": item.get("dosage_notes") or "",
            "disclaimer": "AI-estimated dosage — verify before administering"
        }
    return item

def review_detection(det_id: str, note: str, reviewer: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cursor.execute(
        """UPDATE detections
           SET status = 'reviewed', review_note = ?, reviewed_by = ?, reviewed_at = ?
           WHERE id = ?""",
        (note, reviewer, now_str, det_id)
    )
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated

def delete_detection(det_id: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM detections WHERE id = ?", (det_id,))
    det_deleted = cursor.rowcount > 0
    cursor.execute("DELETE FROM notifications WHERE detection_id = ?", (det_id,))
    conn.commit()
    conn.close()
    return det_deleted

def delete_all_detections() -> int:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM detections")
    deleted_count = cursor.rowcount
    cursor.execute("DELETE FROM notifications")
    conn.commit()
    conn.close()
    return deleted_count

# -----------------------------------------------------------------------------
# NOTIFICATIONS
# -----------------------------------------------------------------------------

def insert_notification(n: Dict[str, Any]) -> Dict[str, Any]:
    notif_id = n.get("id") or f"notif_{uuid.uuid4().hex[:10]}"
    created_at = n.get("created_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    dosage_data = n.get("dosage")
    if hasattr(dosage_data, "to_dict"):
        dosage_data = dosage_data.to_dict()
    dosage_json = json.dumps(dosage_data) if isinstance(dosage_data, dict) else (dosage_data or None)

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO notifications
           (id, recipient_role, detection_id, species, thumbnail, location_name, lat, lng, timestamp, source_type, uploader, dosage, read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            notif_id,
            n.get("recipient_role", "vet"),
            n.get("detection_id", ""),
            n.get("species", "wildlife").lower(),
            n.get("thumbnail", ""),
            n.get("location_name", "Reserve Sector"),
            float(n.get("lat", 29.5312)) if n.get("lat") is not None else 29.5312,
            float(n.get("lng", 78.7744)) if n.get("lng") is not None else 78.7744,
            n.get("timestamp") or created_at,
            n.get("source_type", "live"),
            n.get("uploader", "Scout"),
            dosage_json,
            int(n.get("read", 0)),
            created_at
        )
    )
    conn.commit()
    conn.close()

    n["id"] = notif_id
    n["created_at"] = created_at
    return n

def get_notifications(role: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    if role:
        cursor.execute("SELECT * FROM notifications WHERE recipient_role = ? OR recipient_role = 'all' ORDER BY created_at DESC LIMIT ?", (role, limit))
    else:
        cursor.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        item = dict(r)
        if item.get("dosage"):
            try:
                item["dosage"] = json.loads(item["dosage"]) if isinstance(item["dosage"], str) else item["dosage"]
            except Exception:
                pass
        results.append(item)
    return results

def mark_notification_read(notif_id: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE notifications SET read = 1 WHERE id = ?", (notif_id,))
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated

def delete_notification(notif_id: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM notifications WHERE id = ? OR detection_id = ?", (notif_id, notif_id))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted

def delete_all_notifications() -> int:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM notifications")
    conn.commit()
    deleted_count = cursor.rowcount
    conn.close()
    return deleted_count

# -----------------------------------------------------------------------------
# ADMIN TELEMETRY & STATS
# -----------------------------------------------------------------------------

def get_admin_stats() -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()

    # Total count
    cursor.execute("SELECT COUNT(*) as total FROM detections")
    total_detections = cursor.fetchone()["total"]

    # By species
    cursor.execute("SELECT species, COUNT(*) as count FROM detections GROUP BY species ORDER BY count DESC")
    by_species = {row["species"].upper(): row["count"] for row in cursor.fetchall()}

    # By source type
    cursor.execute("SELECT source_type, COUNT(*) as count FROM detections GROUP BY source_type")
    by_source = {row["source_type"]: row["count"] for row in cursor.fetchall()}

    # By status
    cursor.execute("SELECT status, COUNT(*) as count FROM detections GROUP BY status")
    by_status = {row["status"]: row["count"] for row in cursor.fetchall()}

    # Total registered users
    cursor.execute("SELECT COUNT(*) as total FROM users")
    total_users = cursor.fetchone()["total"]

    conn.close()

    return {
        "total_detections": total_detections,
        "by_species": by_species,
        "by_source": by_source,
        "by_status": by_status,
        "total_users": total_users
    }

# -----------------------------------------------------------------------------
# PIPELINE MODEL RESULTS & FALSE DETECTION MANAGEMENT
# -----------------------------------------------------------------------------

def insert_model_result(d: Dict[str, Any], auto_filter: bool = True, crop_bgr: Optional[Any] = None) -> Dict[str, Any]:
    from false_detection_manager import false_detection_manager
    if auto_filter:
        sanitized = false_detection_manager.sanitize_payload(d, crop_bgr=crop_bgr)
    else:
        sanitized = d

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO model_results
           (id, timestamp, source_type, species, confidence, bbox_x1, bbox_y1, bbox_x2, bbox_y2,
            bbox_area, aspect_ratio, track_id, is_locked, age, age_range, sex, body_size,
            weight_range, behaviour, attribute_confidence, image_quality_score, blur_score,
            is_valid, filter_reason, lat, lng, location_name, media_ref, model_version, raw_metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            sanitized["id"],
            sanitized["timestamp"],
            sanitized["source_type"],
            sanitized["species"].lower(),
            float(sanitized["confidence"]),
            float(sanitized["bbox_x1"]),
            float(sanitized["bbox_y1"]),
            float(sanitized["bbox_x2"]),
            float(sanitized["bbox_y2"]),
            float(sanitized["bbox_area"]),
            float(sanitized["aspect_ratio"]),
            sanitized.get("track_id"),
            int(sanitized.get("is_locked", 0)),
            sanitized.get("age", ""),
            sanitized.get("age_range", ""),
            sanitized.get("sex", ""),
            sanitized.get("body_size", ""),
            sanitized.get("weight_range", ""),
            sanitized.get("behaviour", ""),
            float(sanitized.get("attribute_confidence", 0.0)),
            float(sanitized.get("image_quality_score", 0.8)),
            float(sanitized.get("blur_score", 0.0)),
            int(sanitized.get("is_valid", 1)),
            sanitized.get("filter_reason", "PASSED"),
            float(sanitized.get("lat", 29.5312)),
            float(sanitized.get("lng", 78.7744)),
            sanitized.get("location_name", "Corbett Reserve"),
            sanitized.get("media_ref", ""),
            sanitized.get("model_version", "yolo11s"),
            sanitized.get("raw_metadata", "{}"),
            sanitized.get("created_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        )
    )
    conn.commit()
    conn.close()
    return sanitized

def get_model_results(
    species: Optional[str] = None,
    is_valid: Optional[bool] = None,
    min_confidence: Optional[float] = None,
    source_type: Optional[str] = None,
    limit: int = 200
) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()

    query = "SELECT * FROM model_results WHERE 1=1"
    params = []

    if species and species.upper() != "ALL":
        query += " AND LOWER(species) = ?"
        params.append(species.lower())
    if is_valid is not None:
        query += " AND is_valid = ?"
        params.append(1 if is_valid else 0)
    if min_confidence is not None:
        query += " AND confidence >= ?"
        params.append(float(min_confidence))
    if source_type and source_type.upper() != "ALL":
        query += " AND source_type = ?"
        params.append(source_type.lower())

    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        item = dict(r)
        try:
            item["raw_metadata"] = json.loads(item["raw_metadata"]) if item["raw_metadata"] else {}
        except Exception:
            item["raw_metadata"] = {}
        item["bbox"] = [item["bbox_x1"], item["bbox_y1"], item["bbox_x2"], item["bbox_y2"]]
        results.append(item)
    return results

def get_model_result_by_id(result_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM model_results WHERE id = ?", (result_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    item = dict(row)
    try:
        item["raw_metadata"] = json.loads(item["raw_metadata"]) if item["raw_metadata"] else {}
    except Exception:
        item["raw_metadata"] = {}
    item["bbox"] = [item["bbox_x1"], item["bbox_y1"], item["bbox_x2"], item["bbox_y2"]]
    return item

def flag_model_result_false(result_id: str, reason: str = "MANUALLY_FLAGGED") -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE model_results SET is_valid = 0, filter_reason = ? WHERE id = ?",
        (reason, result_id)
    )
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated

def purge_unwanted_model_results(
    purge_all_invalid: bool = True,
    min_confidence: Optional[float] = None,
    older_than_days: Optional[int] = None
) -> int:
    conn = get_db()
    cursor = conn.cursor()

    conditions = []
    params = []

    if purge_all_invalid:
        conditions.append("is_valid = 0")
    if min_confidence is not None:
        conditions.append("confidence < ?")
        params.append(float(min_confidence))
    if older_than_days is not None:
        cutoff_sec = time.time() - (older_than_days * 86400)
        cutoff_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(cutoff_sec))
        conditions.append("timestamp < ?")
        params.append(cutoff_iso)

    if not conditions:
        conditions.append("is_valid = 0")

    where_clause = " OR ".join(conditions) if len(conditions) > 1 and purge_all_invalid else " AND ".join(conditions)
    query = f"DELETE FROM model_results WHERE {where_clause}"

    cursor.execute(query, params)
    conn.commit()
    deleted_count = cursor.rowcount
    conn.close()
    return deleted_count

def get_model_results_stats() -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) as total FROM model_results")
    total = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(*) as valid FROM model_results WHERE is_valid = 1")
    valid = cursor.fetchone()["valid"]

    cursor.execute("SELECT COUNT(*) as invalid FROM model_results WHERE is_valid = 0")
    invalid = cursor.fetchone()["invalid"]

    cursor.execute("SELECT filter_reason, COUNT(*) as count FROM model_results WHERE is_valid = 0 GROUP BY filter_reason ORDER BY count DESC")
    reasons = {row["filter_reason"]: row["count"] for row in cursor.fetchall()}

    cursor.execute("SELECT species, COUNT(*) as count FROM model_results WHERE is_valid = 1 GROUP BY species ORDER BY count DESC")
    by_species = {row["species"].upper(): row["count"] for row in cursor.fetchall()}

    cursor.execute("SELECT source_type, COUNT(*) as count FROM model_results GROUP BY source_type")
    by_source = {row["source_type"]: row["count"] for row in cursor.fetchall()}

    conn.close()

    valid_rate = round((valid / total * 100.0), 1) if total > 0 else 100.0

    return {
        "total_results": total,
        "valid_count": valid,
        "false_detection_count": invalid,
        "valid_rate_percent": valid_rate,
        "rejection_reasons": reasons,
        "by_species": by_species,
        "by_source": by_source
    }
