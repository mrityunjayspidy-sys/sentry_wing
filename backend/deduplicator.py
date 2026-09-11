"""
Shared Animal Deduplication Engine for SentryWing.
Used by both:
  1. Live Camera Streaming WebSocket (/ws/stream)
  2. Video Upload Frame Sampling (/api/detect/video)

Ensures that the same animal observed across consecutive frames is not spammed
as dozens of individual events, but cleanly deduplicated into one high-confidence
encounter event with start/end duration and peak attributes.
"""

import time
import math
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

def compute_iou(boxA: List[float], boxB: List[float]) -> float:
    """Computes Intersection over Union of two normalized bboxes [x1, y1, x2, y2]."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interArea = max(0.0, xB - xA) * max(0.0, yB - yA)
    boxAArea = max(0.0, boxA[2] - boxA[0]) * max(0.0, boxA[3] - boxA[1])
    boxBArea = max(0.0, boxB[2] - boxB[0]) * max(0.0, boxB[3] - boxB[1])

    unionArea = boxAArea + boxBArea - interArea
    if unionArea <= 0.0:
        return 0.0
    return interArea / unionArea

def centroid_distance(boxA: List[float], boxB: List[float]) -> float:
    """Euclidean distance between box centers."""
    cxA = (boxA[0] + boxA[2]) / 2.0
    cyA = (boxA[1] + boxA[3]) / 2.0
    cxB = (boxB[0] + boxB[2]) / 2.0
    cyB = (boxB[1] + boxB[3]) / 2.0
    return math.hypot(cxA - cxB, cyA - cyB)


class ActiveTrack:
    def __init__(self, track_id: int, species: str, bbox: List[float], confidence: float, crop_bgr: np.ndarray, timestamp: float):
        self.track_id = track_id
        self.species = species.lower()
        self.bbox = bbox
        self.peak_confidence = confidence
        self.best_crop = crop_bgr
        self.first_seen_time = timestamp
        self.last_seen_time = timestamp
        self.consecutive_frames = 1
        self.frames_lost = 0
        self.has_been_logged = False
        self.last_logged_time = 0.0


class AnimalDeduplicator:
    def __init__(
        self,
        min_consecutive_frames: int = 2,
        lost_threshold_frames: int = 15,
        relog_cooldown_sec: float = 20.0,
        iou_match_threshold: float = 0.25,
        distance_threshold: float = 0.35
    ):
        self.min_consecutive_frames = min_consecutive_frames
        self.lost_threshold_frames = lost_threshold_frames
        self.relog_cooldown_sec = relog_cooldown_sec
        self.iou_match_threshold = iou_match_threshold
        self.distance_threshold = distance_threshold

        self.tracks: Dict[int, ActiveTrack] = {}
        self.next_track_id = 1

    def reset(self):
        self.tracks.clear()
        self.next_track_id = 1

    def process_frame(
        self,
        detections: List[Any],
        frame_bgr: np.ndarray,
        timestamp_sec: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Ingests detections from a single frame and returns a list of newly confirmed distinct animal events.

        Args:
            detections: List of Detection objects with .bbox, .class_name, .confidence
            frame_bgr: BGR frame numpy array
            timestamp_sec: Optional float timestamp (wall clock or video time in seconds)

        Returns:
            List of confirmed distinct animal dicts:
            [{
                "track_id": int,
                "species": str,
                "confidence": float,
                "bbox": [x1, y1, x2, y2],
                "crop_bgr": np.ndarray,
                "timestamp_sec": float,
                "duration_sec": float
            }, ...]
        """
        now = timestamp_sec if timestamp_sec is not None else time.time()
        frame_h, frame_w = frame_bgr.shape[:2]

        matched_track_ids = set()
        confirmed_events = []

        for det in detections:
            bbox = list(det.bbox)
            species = det.class_name.lower()
            conf = float(det.confidence)

            # Extract crop for potential thumbnail
            px1 = max(0, int(bbox[0] * frame_w))
            py1 = max(0, int(bbox[1] * frame_h))
            px2 = min(frame_w, int(bbox[2] * frame_w))
            py2 = min(frame_h, int(bbox[3] * frame_h))
            crop = frame_bgr[py1:py2, px1:px2].copy() if (px2 > px1 and py2 > py1) else np.zeros((10, 10, 3), dtype=np.uint8)

            # Try to match with existing active track
            best_track_id = None
            best_match_score = -1.0

            for tid, trk in self.tracks.items():
                if tid in matched_track_ids:
                    continue
                if trk.species != species:
                    continue

                iou = compute_iou(bbox, trk.bbox)
                dist = centroid_distance(bbox, trk.bbox)

                if iou >= self.iou_match_threshold or dist <= self.distance_threshold:
                    score = iou + (1.0 - dist)
                    if score > best_match_score:
                        best_match_score = score
                        best_track_id = tid

            if best_track_id is not None:
                # Update matched track
                trk = self.tracks[best_track_id]
                matched_track_ids.add(best_track_id)
                trk.bbox = bbox
                trk.last_seen_time = now
                trk.consecutive_frames += 1
                trk.frames_lost = 0

                if conf > trk.peak_confidence:
                    trk.peak_confidence = conf
                    if crop.size > 0:
                        trk.best_crop = crop

                # Check if this animal should be confirmed & logged
                should_log = False
                if not trk.has_been_logged and trk.consecutive_frames >= self.min_consecutive_frames:
                    should_log = True
                elif trk.has_been_logged and (now - trk.last_logged_time > self.relog_cooldown_sec):
                    should_log = True

                if should_log:
                    trk.has_been_logged = True
                    trk.last_logged_time = now
                    duration = max(0.0, now - trk.first_seen_time)
                    confirmed_events.append({
                        "track_id": trk.track_id,
                        "species": trk.species,
                        "confidence": round(trk.peak_confidence, 3),
                        "bbox": trk.bbox,
                        "crop_bgr": trk.best_crop,
                        "timestamp_sec": now,
                        "duration_sec": round(duration, 2)
                    })

            else:
                # New animal sighting track
                new_id = self.next_track_id
                self.next_track_id += 1
                new_trk = ActiveTrack(new_id, species, bbox, conf, crop, now)

                # If min_consecutive_frames == 1 (e.g. video sampling where frames are spaced 1s apart), log immediately
                if self.min_consecutive_frames <= 1:
                    new_trk.has_been_logged = True
                    new_trk.last_logged_time = now
                    confirmed_events.append({
                        "track_id": new_id,
                        "species": species,
                        "confidence": round(conf, 3),
                        "bbox": bbox,
                        "crop_bgr": crop,
                        "timestamp_sec": now,
                        "duration_sec": 0.0
                    })

                self.tracks[new_id] = new_trk
                matched_track_ids.add(new_id)

        # Increment frames_lost for tracks not seen in this frame
        lost_tracks = []
        for tid, trk in self.tracks.items():
            if tid not in matched_track_ids:
                trk.frames_lost += 1
                if trk.frames_lost >= self.lost_threshold_frames:
                    lost_tracks.append(tid)

        for tid in lost_tracks:
            del self.tracks[tid]

        return confirmed_events
