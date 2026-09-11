"""
Main FastAPI server for SentryWing Wildlife Intelligence & Target Tracking.
Provides:
  - Auth: login, register, me with role verification ('user', 'vet', 'admin')
  - Live mode: WebSocket /ws/stream with shared AnimalDeduplicator
  - Photo mode: POST /api/detect/photo single-pass detection + attributes + geolocation
  - Video mode: POST /api/detect/video with frame sampling (default 1s) + shared AnimalDeduplicator
  - Detections CRUD: GET /api/detections, GET /api/detections/{id}, POST /api/detections/{id}/review, DELETE
  - Notifications: WebSocket /ws/notifications push stream + REST endpoints
  - Admin: GET /api/admin/users, POST /api/admin/users/{id}/deactivate, POST /api/admin/users/{id}/role, GET /api/admin/stats
"""

import time
import socket
import logging
import json
import base64
import os
import shutil
import tempfile
from typing import Optional, Dict, Any, List
import numpy as np
import cv2

import httpx
import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from config import config
from inference import (
    inference_engine,
    run_detection,
    run_attributes,
    load_detector,
    load_attribute_model,
    Detection,
    AttributeResult
)
from dosage import (
    dosage_engine,
    run_dosage,
    load_dosage_model,
    DosageResult
)
from tracker import TargetTracker, TrackingStatus
from deduplicator import AnimalDeduplicator
from notification_manager import notification_manager
from feed_publisher import feed_publisher
import database as db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("server")

# Ensure DB is initialized on startup
db.init_db()

app = FastAPI(
    title="SentryWing Wildlife Intelligence API",
    description="Role-gated multi-mode animal detection, target locking, and real-time alerts",
    version="2.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.get("/health")
def health_check():
    return {
        "status": "online",
        "detector_type": inference_engine.detector_type,
        "attribute_type": inference_engine.attribute_type,
        "dosage_type": dosage_engine.model_type,
        "local_ip": get_local_ip(),
        "timestamp": time.time()
    }


@app.get("/api/status")
def get_status():
    return {
        "server": "online",
        "local_ip": get_local_ip(),
        "port": config.PORT,
        "detector_type": inference_engine.detector_type,
        "attribute_type": inference_engine.attribute_type,
        "dosage_type": dosage_engine.model_type,
        "detector_models": {
            "onnx_exists": config.DETECTOR_ONNX_PATH.exists(),
            "pt_exists": config.DETECTOR_PT_PATH.exists(),
        },
        "config": {
            "confidence_threshold": config.CONFIDENCE_THRESHOLD,
            "lock_lost_threshold": config.LOCK_LOST_THRESHOLD,
            "center_deadband": config.CENTER_DEADBAND,
        },
        "publishing": {
            "enabled": feed_publisher.enabled,
            "target_url": feed_publisher.target_url,
            "published_count": feed_publisher.published_count,
            "subscribers_count": len(feed_publisher.local_subscribers)
        }
    }


# =============================================================================
# AUTHENTICATION APIS (EMAIL + PASSWORD + ROLE SELECTION)
# =============================================================================

@app.post("/api/auth/register")
def register(payload: Dict[str, Any] = Body(...)):
    email = payload.get("email", "").strip()
    password = payload.get("password", "")
    name = payload.get("name", "").strip()
    role = payload.get("role", "user").strip().lower()

    if not email or not password or not name:
        raise HTTPException(status_code=400, detail="Name, email, and password are required.")

    if role not in ("user", "vet", "admin"):
        role = "user"

    try:
        user = db.create_user(name=name, email=email, password=password, role=role)
        return {"status": "success", "user": user}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/auth/login")
def login(payload: Dict[str, Any] = Body(...)):
    email = payload.get("email", "").strip()
    password = payload.get("password", "")
    role = payload.get("role")  # Optional role confirmation

    user = db.verify_user(email=email, password=password, role=role)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email, password, or role mismatch.")

    return {"status": "success", "user": user}


@app.get("/api/auth/me")
def get_current_user(email: str):
    user = db.get_user_by_email(email)
    if not user or user["is_active"] == 0:
        raise HTTPException(status_code=404, detail="User not found or inactive.")
    return {"status": "success", "user": user}


# =============================================================================
# NOTIFICATION FAN-OUT HELPER
# =============================================================================

async def fan_out_detection_alert(detection: Dict[str, Any]):
    """
    Persists notifications for all users with role 'vet' and role 'admin'
    and pushes real-time WebSocket alert payload.
    """
    det_id = detection.get("id")
    species = detection.get("species", "wildlife")
    thumb = detection.get("media_ref", "")
    loc_name = detection.get("location_name", "Reserve Sector")
    lat = detection.get("lat")
    lng = detection.get("lng")
    ts = detection.get("timestamp")
    source_type = detection.get("source_type", "live")
    uploader = detection.get("uploader_name", "Scout")

    # Insert notification for Vet and Admin roles in database
    for role in ("vet", "admin"):
        db.insert_notification({
            "recipient_role": role,
            "detection_id": det_id,
            "species": species,
            "thumbnail": thumb,
            "location_name": loc_name,
            "lat": lat,
            "lng": lng,
            "timestamp": ts,
            "source_type": source_type,
            "uploader": uploader,
            "dosage": detection.get("dosage"),
            "read": 0
        })

    # Broadcast WebSocket alert payload with Stage 3 dosage recommendation
    payload = {
        "species": species,
        "thumbnail": thumb,
        "location": {
            "lat": lat,
            "lng": lng,
            "name": loc_name
        },
        "timestamp": ts,
        "source_type": source_type,
        "uploader": uploader,
        "detection_id": det_id,
        "confidence": detection.get("confidence"),
        "attributes": detection.get("attributes"),
        "dosage": detection.get("dosage"),
        "drug_recommendation": detection.get("drug_recommendation"),
        "dosage_mg": detection.get("dosage_mg"),
        "dosage_per_kg": detection.get("dosage_per_kg"),
        "dosage_confidence": detection.get("dosage_confidence"),
        "dosage_notes": detection.get("dosage_notes")
    }
    await notification_manager.broadcast(payload)


# =============================================================================
# MODE 3: PHOTO UPLOAD DETECTION FLOW
# =============================================================================

@app.post("/api/detect/photo")
async def detect_photo(
    file: UploadFile = File(...),
    uploader_id: str = Form("user_01"),
    uploader_name: str = Form("Ranger Maya Patil"),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    location_name: Optional[str] = Form("Waterhole Trail 3"),
    conf_threshold: float = Form(0.25)
):
    """
    Single-pass detection on uploaded still image.
    Generates bounding boxes, Stage 2 attributes, persists to detections table,
    and fans out alert to Vets & Admins.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No image file uploaded")

    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file format")

    img_h, img_w = img.shape[:2]
    detections = run_detection(img, conf_threshold)

    annotated = img.copy()
    created_events = []

    for det in detections:
        x1, y1, x2, y2 = det.bbox
        px1 = max(0, int(x1 * img_w))
        py1 = max(0, int(y1 * img_h))
        px2 = min(img_w, int(x2 * img_w))
        py2 = min(img_h, int(y2 * img_h))

        bbox_w_px = px2 - px1
        bbox_h_px = py2 - py1

        # Padded crop for Stage 2
        pad_x = int(bbox_w_px * 0.08)
        pad_y = int(bbox_h_px * 0.08)
        crop_x1 = max(0, px1 - pad_x)
        crop_y1 = max(0, py1 - pad_y)
        crop_x2 = min(img_w, px2 + pad_x)
        crop_y2 = min(img_h, py2 + pad_y)

        attr_dict = {}
        thumb_b64 = ""

        if crop_x2 > crop_x1 and crop_y2 > crop_y1:
            crop = img[crop_y1:crop_y2, crop_x1:crop_x2]
            attr_res = run_attributes(
                crop,
                det.class_name,
                bbox_w_px=bbox_w_px,
                bbox_h_px=bbox_h_px,
                img_w=img_w,
                img_h=img_h
            )
            attr_dict = attr_res.to_dict() if attr_res else {}

            _, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            thumb_b64 = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

        # STAGE 3: Dart Dosage Calculator
        dosage_res = run_dosage(
            species=det.class_name,
            age=attr_dict.get("age", "adult"),
            health_attributes=attr_dict
        )
        if "estimated_weight_kg" not in attr_dict and getattr(dosage_res, "estimated_weight_kg", None):
            attr_dict["estimated_weight_kg"] = dosage_res.estimated_weight_kg

        # Draw on annotated preview
        cv2.rectangle(annotated, (px1, py1), (px2, py2), (0, 255, 136), 3)
        label_text = f"{det.class_name.upper()} {int(det.confidence * 100)}%"
        cv2.putText(annotated, label_text, (px1, max(24, py1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 136), 2, cv2.LINE_AA)

        # Persist detection with Stage 3 dosage in SQLite
        det_record = {
            "uploader_id": uploader_id,
            "uploader_name": uploader_name,
            "source_type": "photo",
            "media_ref": thumb_b64,
            "species": det.class_name,
            "confidence": round(float(det.confidence), 3),
            "bbox": det.bbox,
            "attributes": attr_dict,
            "dosage": dosage_res.to_dict(),
            "drug_recommendation": dosage_res.drug_recommendation,
            "dosage_mg": dosage_res.dosage_mg,
            "dosage_per_kg": dosage_res.dosage_per_kg,
            "dosage_confidence": dosage_res.confidence,
            "dosage_notes": dosage_res.notes,
            "lat": lat if lat is not None else 29.5312,
            "lng": lng if lng is not None else 78.7744,
            "location_name": location_name or "Field Photo Inspection",
            "status": "new"
        }
        saved = db.insert_detection(det_record)
        created_events.append(saved)
        try:
            db.insert_model_result({
                "id": f"res_{saved['id']}",
                "source_type": "photo",
                "species": det.class_name,
                "confidence": det.confidence,
                "bbox": det.bbox,
                "attributes": attr_dict,
                "lat": det_record["lat"],
                "lng": det_record["lng"],
                "location_name": det_record["location_name"],
                "media_ref": thumb_b64
            }, auto_filter=True, crop_bgr=crop)
        except Exception as err:
            logger.warning(f"Error persisting photo model result: {err}")
        await fan_out_detection_alert(saved)

    _, full_buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    annotated_b64 = f"data:image/jpeg;base64,{base64.b64encode(full_buf).decode('utf-8')}"

    return {
        "status": "success",
        "count": len(detections),
        "detections": created_events,
        "events": created_events,
        "annotated_image": annotated_b64,
        "filename": file.filename
    }


# =============================================================================
# MODE 2: VIDEO UPLOAD WITH SAMPLING & SHARED DEDUPLICATION
# =============================================================================

@app.post("/api/detect/video")
async def detect_video_upload(
    file: UploadFile = File(...),
    uploader_id: str = Form("user_01"),
    uploader_name: str = Form("Ranger Maya Patil"),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    location_name: Optional[str] = Form("Ramganga River Clearing"),
    sample_interval_sec: float = Form(1.0),
    conf_threshold: float = Form(0.25),
    max_duration_sec: Optional[float] = Form(120.0)
):
    """
    Samples video frames at configurable interval (default every 1.0s),
    runs YOLO detection on sampled frames, feeds through shared AnimalDeduplicator,
    persists distinct animal sightings with timestamps-in-video, and fans out alerts.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No video file uploaded")

    suffix = os.path.splitext(file.filename)[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
        temp_input_path = tmp_in.name
        shutil.copyfileobj(file.file, tmp_in)

    cap = cv2.VideoCapture(temp_input_path)
    if not cap.isOpened():
        if os.path.exists(temp_input_path):
            os.remove(temp_input_path)
        raise HTTPException(status_code=400, detail="Unable to decode video file")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_duration_sec = total_frames / fps if fps > 0 else 0.0

    frame_step = max(1, int(round(fps * sample_interval_sec)))
    limit_frames = int(fps * max_duration_sec) if max_duration_sec else total_frames

    # Instantiate shared AnimalDeduplicator
    deduplicator = AnimalDeduplicator(
        min_consecutive_frames=1,     # In 1-second sampling, 1 confirmed sample is sufficient
        lost_threshold_frames=3,      # Lost after 3 consecutive sample intervals
        relog_cooldown_sec=15.0
    )

    frame_idx = 0
    sampled_count = 0
    distinct_events = []

    try:
        while frame_idx < total_frames and frame_idx < limit_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            curr_time_sec = round(frame_idx / fps, 2)
            sampled_count += 1

            detections = run_detection(frame, conf_threshold)

            # Feed to shared deduplicator
            confirmed = deduplicator.process_frame(detections, frame, timestamp_sec=curr_time_sec)

            for item in confirmed:
                crop = item["crop_bgr"]
                thumb_b64 = ""
                attr_dict = {}

                if crop.size > 0:
                    attr_res = run_attributes(crop, item["species"], img_w=frame.shape[1], img_h=frame.shape[0])
                    attr_dict = attr_res.to_dict() if attr_res else {}
                    _, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                    thumb_b64 = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

                # STAGE 3: Dart Dosage Calculator
                dosage_res = run_dosage(
                    species=item["species"],
                    age=attr_dict.get("age", "adult"),
                    health_attributes=attr_dict
                )
                if "estimated_weight_kg" not in attr_dict and getattr(dosage_res, "estimated_weight_kg", None):
                    attr_dict["estimated_weight_kg"] = dosage_res.estimated_weight_kg

                det_record = {
                    "uploader_id": uploader_id,
                    "uploader_name": uploader_name,
                    "source_type": "video",
                    "media_ref": thumb_b64,
                    "species": item["species"],
                    "confidence": item["confidence"],
                    "bbox": item["bbox"],
                    "attributes": attr_dict,
                    "dosage": dosage_res.to_dict(),
                    "drug_recommendation": dosage_res.drug_recommendation,
                    "dosage_mg": dosage_res.dosage_mg,
                    "dosage_per_kg": dosage_res.dosage_per_kg,
                    "dosage_confidence": dosage_res.confidence,
                    "dosage_notes": dosage_res.notes,
                    "lat": lat if lat is not None else 29.5312,
                    "lng": lng if lng is not None else 78.7744,
                    "location_name": location_name or f"Video ({file.filename})",
                    "status": "new"
                }
                saved = db.insert_detection(det_record)
                saved["time_in_video_sec"] = curr_time_sec
                distinct_events.append(saved)
                try:
                    db.insert_model_result({
                        "id": f"res_{saved['id']}",
                        "source_type": "video",
                        "species": item["species"],
                        "confidence": item["confidence"],
                        "bbox": item["bbox"],
                        "attributes": attr_dict,
                        "lat": det_record["lat"],
                        "lng": det_record["lng"],
                        "location_name": det_record["location_name"],
                        "media_ref": thumb_b64,
                        "track_id": item.get("track_id")
                    }, auto_filter=True, crop_bgr=crop)
                except Exception as err:
                    logger.warning(f"Error persisting video model result: {err}")
                await fan_out_detection_alert(saved)

            frame_idx += frame_step

    finally:
        cap.release()
        if os.path.exists(temp_input_path):
            try:
                os.remove(temp_input_path)
            except Exception:
                pass

    return {
        "status": "success",
        "filename": file.filename,
        "video_duration_sec": round(video_duration_sec, 2),
        "total_frames": total_frames,
        "sampled_frames": sampled_count,
        "sample_interval_sec": sample_interval_sec,
        "distinct_events": distinct_events
    }


# =============================================================================
# MODE 1: LIVE WEBSOCKET STREAM WITH SHARED DEDUPLICATION
# =============================================================================

@app.websocket("/ws/stream")
async def websocket_stream(
    websocket: WebSocket,
    publish: Optional[bool] = None,
    target_url: Optional[str] = None
):
    """
    Real-time video frame streaming and target tracking socket.
    Reuses inference pipeline and feeds frames through shared AnimalDeduplicator.
    Supports publish mode flag and external live feed dispatch.
    """
    await websocket.accept()
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Stream client connected from {client_host}")

    if publish is not None:
        feed_publisher.set_enabled(bool(publish))
    if target_url:
        feed_publisher.set_target_url(target_url)

    tracker = TargetTracker()
    last_frame_time = time.time()
    last_known_detections: list[Detection] = []

    # Stream session metadata
    session_info = {
        "uploader_id": "user_01",
        "uploader_name": "Ranger Maya Patil",
        "lat": 29.5312,
        "lng": 78.7744,
        "location_name": "Corbett Sector 4 Patrol"
    }

    # Instantiate shared AnimalDeduplicator for live 12-15 FPS stream
    deduplicator = AnimalDeduplicator(
        min_consecutive_frames=2,    # Requires 2 consecutive frames to confirm distinct target
        lost_threshold_frames=15,    # Lost after 15 frames
        relog_cooldown_sec=20.0
    )

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            # Text control commands
            if "text" in message and message["text"]:
                try:
                    cmd = json.loads(message["text"])
                    cmd_type = cmd.get("type")

                    if cmd_type == "init_session":
                        if "uploader_id" in cmd: session_info["uploader_id"] = cmd["uploader_id"]
                        if "uploader_name" in cmd: session_info["uploader_name"] = cmd["uploader_name"]
                        if "location" in cmd and isinstance(cmd["location"], dict):
                            session_info["lat"] = cmd["location"].get("lat", 29.5312)
                            session_info["lng"] = cmd["location"].get("lng", 78.7744)
                            session_info["location_name"] = cmd["location"].get("address") or cmd["location"].get("sector") or cmd["location"].get("name") or "Field Patrol"
                        await websocket.send_json({"type": "session_ack", "session": session_info})

                    elif cmd_type == "update_location":
                        if "location" in cmd and isinstance(cmd["location"], dict):
                            loc = cmd["location"]
                            if "lat" in loc and loc["lat"] is not None:
                                session_info["lat"] = float(loc["lat"])
                            if "lng" in loc and loc["lng"] is not None:
                                session_info["lng"] = float(loc["lng"])
                            if "name" in loc and loc["name"]:
                                session_info["location_name"] = str(loc["name"])
                            elif "location_name" in loc and loc["location_name"]:
                                session_info["location_name"] = str(loc["location_name"])
                            if "accuracy" in loc:
                                session_info["accuracy"] = loc["accuracy"]
                        await websocket.send_json({"type": "location_ack", "location": session_info})

                    elif cmd_type == "lock_target":
                        tracker.manual_lock_target(target_id=cmd.get("id"), detections=last_known_detections)
                    elif cmd_type == "lock_coord":
                        tracker.manual_lock_target(norm_x=cmd.get("x"), norm_y=cmd.get("y"), detections=last_known_detections)
                    elif cmd_type == "unlock":
                        tracker.manual_unlock()
                    elif cmd_type == "set_auto_lock":
                        tracker.set_auto_lock(bool(cmd.get("value", True)))
                    elif cmd_type == "set_publish_mode":
                        if "enabled" in cmd:
                            feed_publisher.set_enabled(bool(cmd["enabled"]))
                        if "url" in cmd and cmd["url"] is not None:
                            feed_publisher.set_target_url(str(cmd["url"]))
                        await websocket.send_json({
                            "type": "publish_mode_ack",
                            "enabled": feed_publisher.enabled,
                            "target_url": feed_publisher.target_url
                        })
                    elif cmd_type == "ping":
                        await websocket.send_json({"type": "pong", "time": time.time()})
                except json.JSONDecodeError:
                    pass
                continue

            # Binary JPEG video frame
            if "bytes" in message and message["bytes"]:
                start_proc_time = time.time()
                frame_bytes = message["bytes"]

                nparr = np.frombuffer(frame_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame is None or frame.size == 0:
                    continue

                frame_h, frame_w = frame.shape[:2]

                # STAGE 1: Detector
                detections = run_detection(frame, config.CONFIDENCE_THRESHOLD)
                last_known_detections = detections

                # TRACKER
                tracking_status, locked_det = tracker.update(detections)

                # STAGE 2 & 3: Attributes + Dart Dosage if locked
                attribute_result: Optional[AttributeResult] = None
                dosage_result: Optional[DosageResult] = None
                if tracking_status.locked and locked_det is not None:
                    x1, y1, x2, y2 = locked_det.bbox
                    px1 = max(0, int(x1 * frame_w))
                    py1 = max(0, int(y1 * frame_h))
                    px2 = min(frame_w, int(x2 * frame_w))
                    py2 = min(frame_h, int(y2 * frame_h))
                    if px2 > px1 and py2 > py1:
                        target_crop = frame[py1:py2, px1:px2]
                        attribute_result = run_attributes(target_crop, locked_det.class_name, img_w=frame_w, img_h=frame_h)
                        if attribute_result:
                            dosage_result = run_dosage(
                                species=locked_det.class_name,
                                age=attribute_result.age,
                                health_attributes=attribute_result.to_dict()
                            )

                # EXTERNAL FEED PUBLISHING: raw frame + location + timestamp always; lock data + dosage when active
                await feed_publisher.publish_frame(
                    frame_bytes=frame_bytes,
                    location=session_info,
                    tracking_status=tracking_status,
                    attribute_result=attribute_result,
                    uploader_info={
                        "id": session_info["uploader_id"],
                        "name": session_info["uploader_name"]
                    },
                    dosage_result=dosage_result
                )

                # SHARED DEDUPLICATION
                now_ts = time.time()
                confirmed_sightings = deduplicator.process_frame(detections, frame, timestamp_sec=now_ts)

                for item in confirmed_sightings:
                    crop = item["crop_bgr"]
                    thumb_b64 = ""
                    attr_dict = {}

                    if crop.size > 0:
                        attr_res = run_attributes(crop, item["species"], img_w=frame_w, img_h=frame_h)
                        attr_dict = attr_res.to_dict() if attr_res else {}
                        _, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                        thumb_b64 = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"

                    # STAGE 3: Dart Dosage Calculator
                    dosage_res = run_dosage(
                        species=item["species"],
                        age=attr_dict.get("age", "adult"),
                        health_attributes=attr_dict
                    )
                    if "estimated_weight_kg" not in attr_dict and getattr(dosage_res, "estimated_weight_kg", None):
                        attr_dict["estimated_weight_kg"] = dosage_res.estimated_weight_kg

                    det_record = {
                        "uploader_id": session_info["uploader_id"],
                        "uploader_name": session_info["uploader_name"],
                        "source_type": "live",
                        "media_ref": thumb_b64,
                        "species": item["species"],
                        "confidence": item["confidence"],
                        "bbox": item["bbox"],
                        "attributes": attr_dict,
                        "dosage": dosage_res.to_dict(),
                        "drug_recommendation": dosage_res.drug_recommendation,
                        "dosage_mg": dosage_res.dosage_mg,
                        "dosage_per_kg": dosage_res.dosage_per_kg,
                        "dosage_confidence": dosage_res.confidence,
                        "dosage_notes": dosage_res.notes,
                        "lat": session_info["lat"],
                        "lng": session_info["lng"],
                        "location_name": session_info["location_name"],
                        "status": "new"
                    }
                    saved = db.insert_detection(det_record)
                    logger.info(f"Live distinct animal logged: {item['species'].upper()} ({saved['id']}) — Dosage: {dosage_res.dosage_mg} mg {dosage_res.drug_recommendation}")
                    try:
                        db.insert_model_result({
                            "id": f"res_{saved['id']}",
                            "source_type": "live",
                            "species": item["species"],
                            "confidence": item["confidence"],
                            "bbox": item["bbox"],
                            "attributes": attr_dict,
                            "lat": det_record["lat"],
                            "lng": det_record["lng"],
                            "location_name": det_record["location_name"],
                            "media_ref": thumb_b64,
                            "track_id": item.get("track_id"),
                            "is_locked": 1 if tracking_status.locked else 0
                        }, auto_filter=True, crop_bgr=crop)
                    except Exception as err:
                        logger.warning(f"Error persisting stream model result: {err}")

                    # Fan out alert to Vets & Admins
                    await fan_out_detection_alert(saved)

                    # Notify stream client
                    await websocket.send_json({
                        "type": "distinct_animal_logged",
                        "detection": saved
                    })

                now = time.time()
                instant_fps = 1.0 / max(1e-5, (now - last_frame_time))
                last_frame_time = now
                proc_latency_ms = round((now - start_proc_time) * 1000.0, 2)

                response_payload = {
                    "type": "telemetry",
                    "timestamp": round(now, 4),
                    "fps": round(instant_fps, 1),
                    "latency_ms": proc_latency_ms,
                    "detections": [d.to_dict() for d in detections],
                    "tracking": tracking_status.to_dict(),
                    "attributes": attribute_result.to_dict() if attribute_result else None,
                    "dosage": dosage_result.to_dict() if dosage_result else None
                }
                await websocket.send_json(response_payload)

    except WebSocketDisconnect:
        logger.info(f"Stream client disconnected: {client_host}")
    except Exception as e:
        logger.error(f"Stream error: {e}", exc_info=True)


# =============================================================================
# DETECTIONS QUERY & REVIEW APIS
# =============================================================================

@app.get("/api/detections")
def get_detections(
    uploader_id: Optional[str] = None,
    species: Optional[str] = None,
    status: Optional[str] = None,
    source_type: Optional[str] = None,
    limit: int = 200
):
    events = db.get_detections(
        uploader_id=uploader_id,
        species=species,
        status=status,
        source_type=source_type,
        limit=limit
    )
    return {"status": "success", "count": len(events), "events": events}


@app.get("/api/detections/{det_id}")
def get_detection_detail(det_id: str):
    item = db.get_detection_by_id(det_id)
    if not item:
        raise HTTPException(status_code=404, detail="Detection not found")
    return {"status": "success", "event": item}


@app.post("/api/detections/{det_id}/review")
def review_detection_endpoint(det_id: str, payload: Dict[str, str] = Body(...)):
    note = payload.get("review_note", "")
    reviewer = payload.get("reviewer_name", "Veterinarian")
    updated = db.review_detection(det_id, note, reviewer)
    if not updated:
        raise HTTPException(status_code=404, detail="Detection not found")
    return {"status": "success", "id": det_id, "review_note": note}


@app.delete("/api/detections/{det_id}")
def delete_detection_endpoint(det_id: str):
    deleted = db.delete_detection(det_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Detection not found")
    return {"status": "success", "id": det_id}


@app.delete("/api/detections")
def delete_all_detections_endpoint():
    count = db.delete_all_detections()
    return {"status": "success", "deleted_count": count}


# =============================================================================
# PIPELINE MODEL RESULTS & FALSE DETECTION API
# =============================================================================

@app.get("/api/pipeline/model-results")
def get_pipeline_model_results_endpoint(
    species: Optional[str] = None,
    is_valid: Optional[bool] = True,
    min_confidence: Optional[float] = None,
    source_type: Optional[str] = None,
    limit: int = 200
):
    """
    Retrieves model results for downstream ML pipeline models, with automated false
    detections filtered out by default (set is_valid=null or false to inspect false positives).
    """
    results = db.get_model_results(
        species=species,
        is_valid=is_valid,
        min_confidence=min_confidence,
        source_type=source_type,
        limit=limit
    )
    return {
        "status": "success",
        "count": len(results),
        "results": results,
        "filter_applied": {
            "is_valid": is_valid,
            "species": species,
            "min_confidence": min_confidence,
            "source_type": source_type
        }
    }


@app.get("/api/pipeline/model-results/stats")
def get_pipeline_model_results_stats_endpoint():
    """
    Returns statistics on valid vs false detections, rejection reason breakdown,
    and species distribution for pipeline telemetry.
    """
    return {"status": "success", "stats": db.get_model_results_stats()}


@app.get("/api/pipeline/model-results/{result_id}")
def get_single_model_result_endpoint(result_id: str):
    item = db.get_model_result_by_id(result_id)
    if not item:
        raise HTTPException(status_code=404, detail="Model result not found")
    return {"status": "success", "result": item}


@app.post("/api/pipeline/model-results")
def create_pipeline_model_result_endpoint(payload: Dict[str, Any] = Body(...)):
    """
    Allows external or downstream models to ingest candidate detections with automatic
    false detection screening and payload sanitization.
    """
    auto_filter = payload.get("auto_filter", True)
    saved = db.insert_model_result(payload, auto_filter=auto_filter)
    return {"status": "success", "result": saved}


@app.post("/api/pipeline/model-results/{result_id}/flag-false")
def flag_pipeline_result_false_endpoint(result_id: str, payload: Dict[str, str] = Body(default={})):
    reason = payload.get("reason", "MANUALLY_FLAGGED")
    updated = db.flag_model_result_false(result_id, reason=reason)
    if not updated:
        raise HTTPException(status_code=404, detail="Model result not found")
    return {"status": "success", "id": result_id, "is_valid": 0, "filter_reason": reason}


@app.delete("/api/pipeline/model-results/unwanted")
def purge_unwanted_pipeline_results_endpoint(
    purge_all_invalid: bool = True,
    min_confidence: Optional[float] = None,
    older_than_days: Optional[int] = None
):
    """
    Removes false detections and unwanted clutter from the database to keep storage lightweight.
    """
    deleted = db.purge_unwanted_model_results(
        purge_all_invalid=purge_all_invalid,
        min_confidence=min_confidence,
        older_than_days=older_than_days
    )
    return {"status": "success", "purged_count": deleted}



# =============================================================================
# NOTIFICATIONS & PUSH WEBSOCKET
# =============================================================================

@app.get("/api/notifications")
def get_notifications_endpoint(role: Optional[str] = None, limit: int = 50):
    notifs = db.get_notifications(role=role, limit=limit)
    return {"status": "success", "count": len(notifs), "notifications": notifs}


@app.post("/api/notifications/{notif_id}/read")
def mark_read_endpoint(notif_id: str):
    success = db.mark_notification_read(notif_id)
    return {"status": "success" if success else "not_found"}


@app.delete("/api/notifications/{notif_id}")
def delete_notification_endpoint(notif_id: str):
    success = db.delete_notification(notif_id)
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "success", "id": notif_id}


@app.delete("/api/notifications")
def delete_all_notifications_endpoint():
    count = db.delete_all_notifications()
    return {"status": "success", "deleted_count": count}


@app.websocket("/ws/notifications")
async def websocket_notifications(websocket: WebSocket):
    """
    Real-time push notification socket for Veterinarians and Forest Officers.
    """
    await notification_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "time": time.time()})
            except Exception:
                pass
    except WebSocketDisconnect:
        notification_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"Notification socket closed: {e}")
        notification_manager.disconnect(websocket)


@app.websocket("/ws/live-feed")
async def websocket_live_feed(websocket: WebSocket):
    """
    Real-time Live Feed Viewer socket for Veterinarians, Admins, or downstream subscribers.
    Streams continuous frames + geolocation + lock/bbox data.
    Also accepts incoming frames pushed by field sources like esp32_bridge.
    """
    await feed_publisher.connect_local_subscriber(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "time": time.time()})
                elif "frame" in msg:
                    # Ingest and normalize frame pushed by ESP32 bridge or external field source
                    if "type" not in msg:
                        msg["type"] = "live_feed_frame"
                    if "location" not in msg and ("lat" in msg or "lng" in msg):
                        msg["location"] = {
                            "lat": msg.get("lat", 29.5312),
                            "lng": msg.get("lng", 78.7744),
                            "name": msg.get("location_name") or msg.get("name") or f"ESP32 Post ({msg.get('source_id', 'camera')})"
                        }
                    if "uploader" not in msg and "source_id" in msg:
                        msg["uploader"] = {
                            "id": msg.get("source_id", "esp32-cam-1"),
                            "name": f"ESP32 Sentry [{msg.get('source_id', 'cam-1')}]"
                        }
                    if "lock" not in msg:
                        if msg.get("locked"):
                            msg["lock"] = {
                                "locked": True,
                                "state": "LOCKED",
                                "species": msg.get("species") or msg.get("target_class", "ANIMAL"),
                                "bbox": msg.get("bbox"),
                                "direction": msg.get("direction", "CENTERED"),
                                "dx": msg.get("dx", 0.0),
                                "dy": msg.get("dy", 0.0),
                                "predicted": msg.get("predicted", False),
                                "attributes": msg.get("attributes")
                            }
                        else:
                            msg["lock"] = None
                    await feed_publisher.broadcast_payload(msg, exclude=websocket)
            except Exception:
                pass
    except WebSocketDisconnect:
        feed_publisher.disconnect_local_subscriber(websocket)
    except Exception as e:
        logger.warning(f"Live feed subscriber closed: {e}")
        feed_publisher.disconnect_local_subscriber(websocket)


# =============================================================================
# ADMIN MANAGEMENT & STATS APIS
# =============================================================================

@app.get("/api/admin/users")
def list_admin_users():
    return {"status": "success", "users": db.get_all_users()}


@app.post("/api/admin/users/{user_id}/deactivate")
def deactivate_user_endpoint(user_id: str, payload: Dict[str, Any] = Body(...)):
    is_active = int(payload.get("is_active", 0))
    updated = db.toggle_user_active(user_id, is_active)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "success", "id": user_id, "is_active": is_active}


@app.post("/api/admin/users/{user_id}/role")
def update_user_role_endpoint(user_id: str, payload: Dict[str, str] = Body(...)):
    role = payload.get("role", "user")
    updated = db.update_user_role(user_id, role)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found or invalid role")
    return {"status": "success", "id": user_id, "role": role}


@app.get("/api/admin/stats")
def get_stats_endpoint():
    return {"status": "success", "stats": db.get_admin_stats()}


# =============================================================================
# ESP32-CAM MJPEG PROXY & STREAM RELAY
# =============================================================================

@app.get("/api/esp32/status")
async def get_esp32_status(url: str = Query("http://172.16.4.122:81/stream")):
    """
    Probes an ESP32-CAM MJPEG stream or HTTP endpoint with a short timeout.
    Returns online status, HTTP status code, latency, and details.
    """
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url)
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            content_type = resp.headers.get("content-type", "")
            return {
                "online": resp.status_code == 200,
                "status_code": resp.status_code,
                "content_type": content_type,
                "latency_ms": elapsed_ms,
                "url": url
            }
    except Exception as e:
        elapsed_ms = round((time.time() - t0) * 1000, 1)
        return {
            "online": False,
            "error": str(e),
            "latency_ms": elapsed_ms,
            "url": url
        }


@app.get("/api/esp32/stream")
async def proxy_esp32_stream(url: str = Query("http://172.16.4.122:81/stream")):
    """
    Proxies an ESP32-CAM MJPEG stream to the frontend browser.
    Eliminates HTTPS Mixed Content blocking, eliminates CORS restrictions,
    and prevents canvas tainting.
    """
    client = httpx.AsyncClient(timeout=None)
    try:
        req = client.build_request("GET", url)
        resp = await client.send(req, stream=True)

        async def stream_generator():
            try:
                async for chunk in resp.aiter_raw():
                    yield chunk
            except (asyncio.CancelledError, GeneratorExit):
                pass
            except Exception as stream_err:
                logger.debug(f"ESP32 stream disconnected: {stream_err}")
            finally:
                await resp.aclose()
                await client.aclose()

        content_type = resp.headers.get(
            "content-type",
            "multipart/x-mixed-replace; boundary=123456789000000000000987654321"
        )
        return StreamingResponse(
            stream_generator(),
            media_type=content_type,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*"
            }
        )
    except Exception as e:
        await client.aclose()
        logger.warning(f"ESP32 stream connection error: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Unable to connect to ESP32 stream at {url}: {e}"
        )


if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting SentryWing server on {config.HOST}:{config.PORT}")
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=False, access_log=False)
