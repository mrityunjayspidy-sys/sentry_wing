"""
SentryWing Inference Module — Real YOLO11s Detector + Rule-Based Attribute Engine.

Stage 1: Ultralytics YOLO animal detector (8 classes:
         tiger, cheetah, lion, hyena, leopard, bear, fox, elephant)
Stage 2: Rule-based attribute engine ported directly from the SentryWing
         Colab notebook (R06–R16). Computes age group, approximate age range,
         sex estimate, body size / indicative weight band, visible behaviour,
         and image quality anomaly screening from the cropped bounding box.

No mock data — the detector requires a trained .pt weights file in models/.
"""

import re
import math
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
import numpy as np
import cv2

from config import config

logger = logging.getLogger("inference")
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Detection:
    """A single detected animal bounding box from Stage 1."""
    id: int
    bbox: List[float]       # [x1, y1, x2, y2] normalised to 0.0–1.0
    class_name: str
    confidence: float
    is_locked: bool = False
    # Pixel-space values kept for Stage 2 attribute engine
    bbox_px: Optional[List[int]] = None   # [x1, y1, x2, y2] in pixels

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("bbox_px", None)   # internal; don't send to frontend
        return d


@dataclass
class AttributeResult:
    """Stage 2 rule-based attribute analysis result."""
    age: str
    age_range: str
    sex: str
    body_size: str
    weight_range: str
    behaviour: str
    confidence: float
    details: str
    quality_flags: List[str]
    estimated_weight_kg: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Species-specific rule tables (verbatim from notebook R09–R13)
# ---------------------------------------------------------------------------

SPECIES_RULES = {
    "tiger":    {"juvenile_aspect_max": 0.72, "large_body_ratio": 0.58},
    "cheetah":  {"juvenile_aspect_max": 0.70, "large_body_ratio": 0.55},
    "lion":     {"juvenile_aspect_max": 0.72, "large_body_ratio": 0.58},
    "hyena":    {"juvenile_aspect_max": 0.70, "large_body_ratio": 0.56},
    "leopard":  {"juvenile_aspect_max": 0.70, "large_body_ratio": 0.55},
    "bear":     {"juvenile_aspect_max": 0.75, "large_body_ratio": 0.60},
    "fox":      {"juvenile_aspect_max": 0.68, "large_body_ratio": 0.52},
    "elephant": {"juvenile_aspect_max": 0.75, "large_body_ratio": 0.60},
}

AGE_PROFILES = {
    "tiger":    {"juvenile": 0.22, "subadult": 0.28, "adult": 0.38, "mature": 0.12},
    "cheetah":  {"juvenile": 0.24, "subadult": 0.28, "adult": 0.36, "mature": 0.12},
    "lion":     {"juvenile": 0.20, "subadult": 0.25, "adult": 0.40, "mature": 0.15},
    "hyena":    {"juvenile": 0.22, "subadult": 0.27, "adult": 0.38, "mature": 0.13},
    "leopard":  {"juvenile": 0.23, "subadult": 0.27, "adult": 0.38, "mature": 0.12},
    "bear":     {"juvenile": 0.20, "subadult": 0.28, "adult": 0.38, "mature": 0.14},
    "fox":      {"juvenile": 0.25, "subadult": 0.28, "adult": 0.35, "mature": 0.10},
    "elephant": {"juvenile": 0.20, "subadult": 0.25, "adult": 0.40, "mature": 0.15},
}

AGE_RANGES = {
    "tiger":    {"juvenile": "0–2 years", "subadult": "2–4 years", "adult": "4–10 years", "mature": "10+ years"},
    "cheetah":  {"juvenile": "0–2 years", "subadult": "2–4 years", "adult": "4–8 years",  "mature": "8+ years"},
    "lion":     {"juvenile": "0–2 years", "subadult": "2–4 years", "adult": "4–10 years", "mature": "10+ years"},
    "hyena":    {"juvenile": "0–2 years", "subadult": "2–4 years", "adult": "4–10 years", "mature": "10+ years"},
    "leopard":  {"juvenile": "0–2 years", "subadult": "2–4 years", "adult": "4–10 years", "mature": "10+ years"},
    "bear":     {"juvenile": "0–3 years", "subadult": "3–6 years", "adult": "6–15 years", "mature": "15+ years"},
    "fox":      {"juvenile": "0–1 year",  "subadult": "1–2 years", "adult": "2–6 years",  "mature": "6+ years"},
    "elephant": {"juvenile": "0–5 years", "subadult": "5–15 years","adult": "15–40 years","mature": "40+ years"},
}

WEIGHT_BANDS = {
    "tiger":    {"small": "40–90 kg",    "medium": "90–160 kg",   "large": "160–250 kg"},
    "cheetah":  {"small": "20–35 kg",    "medium": "35–50 kg",    "large": "50–70 kg"},
    "lion":     {"small": "50–100 kg",   "medium": "100–170 kg",  "large": "170–250 kg"},
    "hyena":    {"small": "25–45 kg",    "medium": "45–60 kg",    "large": "60–85 kg"},
    "leopard":  {"small": "20–35 kg",    "medium": "35–55 kg",    "large": "55–90 kg"},
    "bear":     {"small": "30–100 kg",   "medium": "100–250 kg",  "large": "250–600 kg"},
    "fox":      {"small": "3–6 kg",      "medium": "6–10 kg",     "large": "10–15 kg"},
    "elephant": {"small": "500–1500 kg", "medium": "1500–3000 kg","large": "3000–6000+ kg"},
}

SPECIES_SEX_BIAS = {
    "lion": 0.05, "tiger": 0.00, "leopard": -0.02, "cheetah": 0.01,
    "hyena": 0.02, "bear": 0.00, "fox": -0.01, "elephant": 0.03,
}


# ---------------------------------------------------------------------------
# Stage 2: Rule-based attribute sub-functions (ported from notebook)
# ---------------------------------------------------------------------------

def _visual_quality(crop_bgr: np.ndarray, bbox_w: int, bbox_h: int) -> float:
    """R08 – Resolution & shape quality score."""
    area = crop_bgr.shape[0] * crop_bgr.shape[1]
    if area >= 500_000:
        res = 1.0
    elif area >= 200_000:
        res = 0.85
    elif area >= 80_000:
        res = 0.65
    elif area >= 30_000:
        res = 0.40
    else:
        res = 0.20

    ratio = bbox_w / max(bbox_h, 1)
    shape = 1.0 if 0.25 <= ratio <= 4.0 else 0.60
    return round(max(0.0, min(1.0, 0.7 * res + 0.3 * shape)), 3)


def _estimate_age_forced(species: str, bbox_w: int, bbox_h: int) -> dict:
    """R10 – Forced age-group estimation using species priors + geometry."""
    aspect = bbox_w / max(bbox_h, 1)
    profile = AGE_PROFILES.get(species, AGE_PROFILES["tiger"]).copy()

    if aspect < 0.55:
        adj = {"juvenile": 0.12, "subadult": 0.03, "adult": -0.10, "mature": -0.05}
    elif aspect < 0.85:
        adj = {"juvenile": 0.04, "subadult": 0.04, "adult": -0.04, "mature": -0.02}
    else:
        adj = {"juvenile": -0.04, "subadult": -0.02, "adult": 0.04, "mature": 0.02}

    scores = {k: max(0.01, profile[k] + adj[k]) for k in profile}
    age_group = max(scores, key=scores.get)
    raw_conf = scores[age_group]
    confidence = min(0.88, max(0.55, 0.55 + raw_conf))

    age_range = AGE_RANGES.get(species, AGE_RANGES["tiger"]).get(age_group, "4–10 years")
    return {"value": age_group, "range": age_range, "confidence": round(confidence, 3)}


def _estimate_sex_forced(species: str, crop_bgr: np.ndarray) -> dict:
    """R12 – Heuristic sex estimation from image-level visual statistics."""
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    upper = gray[:int(h * 0.45), :]
    lower = gray[int(h * 0.45):, :]
    upper_mean = float(np.mean(upper)) if upper.size > 0 else 128.0
    lower_mean = float(np.mean(lower)) if lower.size > 0 else 128.0
    texture = float(np.std(gray))

    score = 0.45 * (upper_mean / 255.0) + 0.35 * (lower_mean / 255.0) + 0.20 * min(texture / 100.0, 1.0)
    score += SPECIES_SEX_BIAS.get(species, 0.0)
    score = max(0.0, min(1.0, score))

    sex = "male" if score >= 0.50 else "female"
    confidence = min(0.72, 0.52 + abs(score - 0.50) * 0.50)
    return {"value": sex, "confidence": round(confidence, 3)}


def _estimate_body_size(species: str, bbox_w: int, bbox_h: int, img_w: int, img_h: int) -> dict:
    """R13 – Apparent body size + indicative weight band."""
    animal_area = bbox_w * bbox_h
    image_area = max(img_w * img_h, 1)
    relative = animal_area / image_area

    if relative >= 0.30:
        cat = "large"
    elif relative >= 0.10:
        cat = "medium"
    else:
        cat = "small"

    band = WEIGHT_BANDS.get(species, WEIGHT_BANDS["tiger"])[cat]
    return {"category": cat, "weight_range": band, "confidence": 0.50}


def _extract_weight_from_string(weight_str: Optional[str]) -> Optional[float]:
    """Parses numeric weight estimate from strings like '160–250 kg' or '3500 kg'."""
    if not weight_str or not isinstance(weight_str, str):
        return None
    match_range = re.findall(r"(\d+(?:\.\d+)?)\s*[–\-—to]\s*(\d+(?:\.\d+)?)", weight_str)
    if match_range:
        try:
            return round((float(match_range[0][0]) + float(match_range[0][1])) / 2.0, 1)
        except Exception:
            pass
    match_single = re.findall(r"(\d+(?:\.\d+)?)", weight_str)
    if match_single:
        try:
            return round(float(match_single[0]), 1)
        except Exception:
            pass
    return None


def _analyze_anomalies(crop_bgr: np.ndarray) -> dict:
    """R12 – Visible anomaly / image quality screening."""
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    flags: List[str] = []
    if brightness < 35:
        flags.append("very_dark_image")
    elif brightness > 225:
        flags.append("overexposed_image")
    if contrast < 15:
        flags.append("low_contrast")
    if blur < 30:
        flags.append("possible_motion_or_focus_blur")

    return {"flags": flags, "confidence": 0.50}


def _estimate_behaviour(bbox_w: int, bbox_h: int, quality: float) -> dict:
    """R13 – Basic visible behaviour classification from bbox geometry."""
    if quality < 0.35:
        return {"value": "indeterminate", "confidence": 0.20}

    ratio = bbox_w / max(bbox_h, 1)
    if ratio > 1.8:
        beh = "horizontal_body_posture"
        conf = 0.50
    elif ratio < 0.55:
        beh = "vertical_body_posture"
        conf = 0.45
    else:
        beh = "standing_or_general_posture"
        conf = 0.40

    return {"value": beh, "confidence": round(conf * quality, 3)}


# ---------------------------------------------------------------------------
# Inference Engine
# ---------------------------------------------------------------------------

class InferenceEngine:
    """
    Manages Stage 1 YOLO detector and Stage 2 rule-based attribute analysis.
    Requires a trained Ultralytics YOLO .pt weights file in backend/models/.
    """

    def __init__(self):
        self.detector_type: str = "none"
        self.detector_model: Any = None
        self.attribute_type: str = "rule_engine"   # always rule-based
        self.load_detector()

    # ------------------------------------------------------------------
    # Stage 1 — Detector loading
    # ------------------------------------------------------------------

    def load_detector(self) -> str:
        """
        Loads YOLO detector from models/detector.pt, detector.onnx,
        or any custom .pt / .onnx file placed in backend/models/.
        """
        from ultralytics import YOLO
        import glob
        from pathlib import Path

        search_paths = [
            config.DETECTOR_PT_PATH,
            config.DETECTOR_ONNX_PATH,
        ]

        # Auto-discover any .pt files in backend/models/
        if config.MODELS_DIR.exists():
            for p in config.MODELS_DIR.glob("*.pt"):
                if p not in search_paths:
                    search_paths.append(p)
            for p in config.MODELS_DIR.glob("*.onnx"):
                if p not in search_paths:
                    search_paths.append(p)

        # Also check workspace models folder
        workspace_models = Path(r"D:\SIH\SentryWing_9Species\models")
        if workspace_models.exists():
            for p in workspace_models.glob("*.pt"):
                if p not in search_paths:
                    search_paths.append(p)

        for model_path in search_paths:
            if model_path.exists():
                try:
                    self.detector_model = YOLO(str(model_path))
                    self.detector_type = "yolo_pt" if model_path.suffix == ".pt" else "yolo_onnx"
                    self.active_model_path = str(model_path)
                    logger.info(f"Loaded YOLO detector from: {model_path}")
                    logger.info(f"Model classes: {self.detector_model.names}")
                    return self.detector_type
                except Exception as e:
                    logger.warning(f"Could not load {model_path}: {e}")

        self.detector_type = "none"
        self.detector_model = None
        self.active_model_path = ""
        logger.warning(
            "No detector weights found. Place your .pt or .onnx model into "
            "backend/models/ as detector.pt (or any name)."
        )
        return self.detector_type

    def load_attribute_model(self) -> str:
        """Stage 2 is always the rule-based engine — nothing to load."""
        return "rule_engine"

    # ------------------------------------------------------------------
    # Stage 1 — Detection
    # ------------------------------------------------------------------

    def run_detection(
        self,
        frame_bgr: np.ndarray,
        conf_threshold: Optional[float] = None,
    ) -> List[Detection]:
        """
        Runs the YOLO detector on a BGR video frame.
        Returns a list of Detection objects with normalised bounding boxes.
        Returns an empty list if no model is loaded or nothing is detected.
        """
        if self.detector_model is None:
            return []

        if conf_threshold is None:
            conf_threshold = config.CONFIDENCE_THRESHOLD

        h, w = frame_bgr.shape[:2]

        try:
            results = self.detector_model.predict(
                source=frame_bgr,
                imgsz=config.INPUT_IMAGE_SIZE,
                conf=conf_threshold,
                iou=config.IOU_THRESHOLD,
                verbose=False,
            )
        except Exception as e:
            logger.error(f"YOLO inference error: {e}")
            return []

        detections: List[Detection] = []
        for res in results:
            if res.boxes is None or len(res.boxes) == 0:
                continue
            for i, box in enumerate(res.boxes):
                xyxy = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                cls_name = res.names.get(cls_id, f"class_{cls_id}")

                x1_px, y1_px, x2_px, y2_px = (
                    int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])
                )

                detections.append(Detection(
                    id=len(detections) + 1,
                    bbox=[
                        round(max(0.0, min(1.0, xyxy[0] / w)), 4),
                        round(max(0.0, min(1.0, xyxy[1] / h)), 4),
                        round(max(0.0, min(1.0, xyxy[2] / w)), 4),
                        round(max(0.0, min(1.0, xyxy[3] / h)), 4),
                    ],
                    class_name=cls_name,
                    confidence=round(conf, 3),
                    bbox_px=[x1_px, y1_px, x2_px, y2_px],
                ))

        return detections

    # ------------------------------------------------------------------
    # Stage 2 — Rule-based attribute engine
    # ------------------------------------------------------------------

    def run_attributes(
        self,
        cropped_bgr: np.ndarray,
        class_name: str = "animal",
        bbox_w_px: int = 0,
        bbox_h_px: int = 0,
        img_w: int = 640,
        img_h: int = 480,
    ) -> AttributeResult:
        """
        Runs the SentryWing rule-based attribute engine on a cropped
        bounding-box image.  Ported verbatim from the Colab notebook
        cells R08–R16.
        """
        if cropped_bgr is None or cropped_bgr.size == 0:
            return AttributeResult(
                age="unknown", age_range="unknown", sex="unknown",
                body_size="unknown", weight_range="unknown",
                behaviour="unknown", confidence=0.0,
                details="Target crop unavailable.",
                quality_flags=[],
            )

        species = class_name.lower()
        bw = bbox_w_px if bbox_w_px > 0 else cropped_bgr.shape[1]
        bh = bbox_h_px if bbox_h_px > 0 else cropped_bgr.shape[0]

        # Visual quality score
        quality = _visual_quality(cropped_bgr, bw, bh)

        # Age
        age_info = _estimate_age_forced(species, bw, bh)

        # Sex
        sex_info = _estimate_sex_forced(species, cropped_bgr)

        # Body size + weight band
        size_info = _estimate_body_size(species, bw, bh, img_w, img_h)

        # Anomaly screening
        anom_info = _analyze_anomalies(cropped_bgr)

        # Behaviour
        beh_info = _estimate_behaviour(bw, bh, quality)

        # Overall confidence (average of component confidences)
        overall = round(
            (age_info["confidence"] + sex_info["confidence"]
             + size_info["confidence"] + beh_info["confidence"]) / 4.0,
            3,
        )

        # Assemble human-readable details string
        details = (
            f"{species.capitalize()}: "
            f"Age group {age_info['value']} ({age_info['range']}), "
            f"sex {sex_info['value']}, "
            f"{size_info['category']} body size ({size_info['weight_range']}), "
            f"posture {beh_info['value']}."
        )

        est_weight = _extract_weight_from_string(size_info["weight_range"])

        return AttributeResult(
            age=f"{age_info['value']} ({age_info['range']})",
            age_range=age_info["range"],
            sex=sex_info["value"],
            body_size=size_info["category"],
            weight_range=size_info["weight_range"],
            behaviour=beh_info["value"],
            confidence=overall,
            details=details,
            quality_flags=anom_info["flags"],
            estimated_weight_kg=est_weight,
        )

    # ------------------------------------------------------------------
    # Video inference
    # ------------------------------------------------------------------

    def detect_video(
        self,
        video_path: str,
        output_path: Optional[str] = None,
        conf_threshold: Optional[float] = None,
        frame_stride: int = 1,
        max_frames: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Processes an input video file, detects animals in each frame using YOLO,
        applies the Stage 2 rule-based attribute engine to detected targets,
        and optionally writes an annotated video file.

        Args:
            video_path: Path to the input video file.
            output_path: Optional path to save the annotated output video.
            conf_threshold: Confidence threshold for detections.
            frame_stride: Process every N-th frame (default: 1 = all frames).
            max_frames: Optional limit on total frames to process.

        Returns:
            Dict containing video metadata, summary statistics, and frame-by-frame detections.
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"Unable to open video file: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        writer = None
        if output_path:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(output_path), fourcc, fps / frame_stride, (width, height))

        frames_data: List[Dict[str, Any]] = []
        species_counts: Dict[str, int] = {}
        total_detections = 0
        frame_idx = 0
        processed_count = 0

        # Colors for drawing species bboxes (BGR)
        CLASS_COLORS = {
            "tiger": (34, 139, 34),     # Forest green
            "cheetah": (0, 165, 255),   # Orange
            "lion": (0, 215, 255),      # Gold
            "hyena": (147, 112, 219),   # Purple
            "leopard": (0, 140, 255),   # Dark orange
            "bear": (42, 42, 165),      # Brown
            "fox": (0, 69, 255),        # Red-orange
            "elephant": (205, 133, 63), # Steel blue
        }

        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % frame_stride == 0:
                    detections = self.run_detection(frame, conf_threshold)
                    frame_dets = []
                    
                    for det in detections:
                        total_detections += 1
                        species_counts[det.class_name] = species_counts.get(det.class_name, 0) + 1

                        # Crop and analyze attributes
                        x1, y1, x2, y2 = det.bbox
                        px1 = max(0, int(x1 * width))
                        py1 = max(0, int(y1 * height))
                        px2 = min(width, int(x2 * width))
                        py2 = min(height, int(y2 * height))
                        bw = px2 - px1
                        bh = py2 - py1

                        attr = None
                        if bw > 10 and bh > 10:
                            pad_x = int(bw * 0.08)
                            pad_y = int(bh * 0.08)
                            crop = frame[max(0, py1 - pad_y):min(height, py2 + pad_y),
                                         max(0, px1 - pad_x):min(width, px2 + pad_x)]
                            if crop.size > 0:
                                attr = self.run_attributes(crop, det.class_name, bw, bh, width, height)

                        frame_dets.append({
                            "detection": det.to_dict(),
                            "attributes": attr.to_dict() if attr else None,
                        })

                        # Annotate frame if output writer requested
                        if writer is not None:
                            color = CLASS_COLORS.get(det.class_name.lower(), (0, 255, 0))
                            # Bounding box
                            cv2.rectangle(frame, (px1, py1), (px2, py2), color, 2)
                            
                            # Label banner
                            label = f"{det.class_name} {det.confidence:.2f}"
                            cv2.rectangle(frame, (px1, max(0, py1 - 22)), (px1 + len(label) * 11, py1), color, -1)
                            cv2.putText(frame, label, (px1 + 4, max(14, py1 - 6)),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
                            
                            # Attribute tag below box
                            if attr:
                                attr_tag = f"{attr.age.split(' ')[0]} | {attr.sex} | {attr.body_size}"
                                cv2.putText(frame, attr_tag, (px1, min(height - 6, py2 + 16)),
                                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

                    # Annotate frame timestamp and detection counter
                    if writer is not None:
                        ts_str = f"T: {frame_idx / fps:.2f}s | Animals: {len(detections)}"
                        cv2.putText(frame, ts_str, (16, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                        writer.write(frame)

                    if frame_dets:
                        frames_data.append({
                            "frame_index": frame_idx,
                            "timestamp_s": round(frame_idx / fps, 3),
                            "detections": frame_dets,
                        })

                    processed_count += 1
                    if max_frames and processed_count >= max_frames:
                        break

                frame_idx += 1
        finally:
            cap.release()
            if writer is not None:
                writer.release()

        return {
            "video_info": {
                "fps": round(fps, 2),
                "width": width,
                "height": height,
                "total_frames": total_video_frames,
                "processed_frames": processed_count,
                "duration_seconds": round(total_video_frames / max(fps, 1.0), 2),
            },
            "summary": {
                "total_detections": total_detections,
                "unique_species": list(species_counts.keys()),
                "species_counts": species_counts,
                "frames_with_animals": len(frames_data),
            },
            "output_video": str(output_path) if output_path else None,
            "frames": frames_data,
        }


# ---------------------------------------------------------------------------
# Module-level singleton + convenience wrappers
# ---------------------------------------------------------------------------

inference_engine = InferenceEngine()


def load_detector() -> str:
    return inference_engine.load_detector()


def load_attribute_model() -> str:
    return inference_engine.load_attribute_model()


def run_detection(
    frame_bgr: np.ndarray,
    conf_threshold: Optional[float] = None,
) -> List[Detection]:
    return inference_engine.run_detection(frame_bgr, conf_threshold)


def run_attributes(
    cropped_bgr: np.ndarray,
    class_name: str = "animal",
    bbox_w_px: int = 0,
    bbox_h_px: int = 0,
    img_w: int = 640,
    img_h: int = 480,
) -> AttributeResult:
    return inference_engine.run_attributes(
        cropped_bgr, class_name, bbox_w_px, bbox_h_px, img_w, img_h,
    )


def detect_video(
    video_path: str,
    output_path: Optional[str] = None,
    conf_threshold: Optional[float] = None,
    frame_stride: int = 1,
    max_frames: Optional[int] = None,
) -> Dict[str, Any]:
    return inference_engine.detect_video(
        video_path, output_path, conf_threshold, frame_stride, max_frames
    )

