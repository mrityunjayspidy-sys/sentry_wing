"""
False Detection Management & Payload Sanitization Engine for SentryWing.

Provides:
1. Automated quality & false-detection screening:
   - Confidence thresholding (filters out weak phantom detections)
   - Bounding-box geometry checks (area range, aspect ratio, out-of-bounds)
   - Sharpness & motion-blur verification (cv2.Laplacian variance)
   - Extreme illumination screening (under/over-exposed crops)
   - Valid animal species gating (must be recognized wildlife class)
2. Payload Sanitization:
   - Eliminates bloated multi-megabyte full-frame dumps
   - Retains only lightweight, compressed JPEG crops (or normalized coordinates)
   - Rounds floating-point numbers to 4 decimal places
   - Standardizes Stage 1 and Stage 2 attributes for clean pipeline consumption
"""

import math
import time
import json
import uuid
import logging
from typing import Dict, Any, Tuple, Optional, List
import numpy as np
import cv2

from config import config

logger = logging.getLogger("false_detection_manager")


class FalseDetectionManager:
    def __init__(
        self,
        min_confidence: float = 0.32,
        min_bbox_area: float = 0.003,       # Box must occupy at least 0.3% of the frame
        max_bbox_area: float = 0.95,        # Reject boxes covering > 95% of frame (whole-scene hallucination)
        min_aspect_ratio: float = 0.12,     # Min width / height
        max_aspect_ratio: float = 7.5,      # Max width / height (rejects horizon / fence wires)
        min_blur_score: float = 22.0,       # Laplacian variance threshold for motion blur
        min_intensity: float = 12.0,        # Mean intensity lower bound (pitch dark)
        max_intensity: float = 248.0,       # Mean intensity upper bound (blown out)
        store_false_detections: bool = True # Store false detections with is_valid=0 for diagnostic analysis
    ):
        self.min_confidence = min_confidence
        self.min_bbox_area = min_bbox_area
        self.max_bbox_area = max_bbox_area
        self.min_aspect_ratio = min_aspect_ratio
        self.max_aspect_ratio = max_aspect_ratio
        self.min_blur_score = min_blur_score
        self.min_intensity = min_intensity
        self.max_intensity = max_intensity
        self.store_false_detections = store_false_detections
        self.valid_species = set(s.lower() for s in config.ANIMAL_CLASSES)

    def evaluate_detection(
        self,
        bbox: List[float],
        confidence: float,
        species: str,
        crop_bgr: Optional[np.ndarray] = None,
        frame_shape: Optional[Tuple[int, int]] = None
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Evaluates a candidate detection against quality & false-detection criteria.

        Args:
            bbox: Normalized [x1, y1, x2, y2] in range [0.0, 1.0]
            confidence: Float confidence score (0.0 - 1.0)
            species: Class name string
            crop_bgr: Optional BGR image crop for blur and illumination analysis
            frame_shape: Optional (height, width)

        Returns:
            Tuple of:
              - is_valid (bool): True if detection passes all filters, False if rejected
              - filter_reason (str): 'PASSED' or failure reason code
              - metrics (dict): Diagnostic metrics computed during evaluation
        """
        metrics: Dict[str, Any] = {
            "confidence": round(float(confidence), 4),
            "species": species.lower(),
            "bbox_area": 0.0,
            "aspect_ratio": 1.0,
            "blur_score": None,
            "mean_intensity": None
        }

        # 1. Species verification
        clean_species = species.strip().lower()
        if clean_species not in self.valid_species and clean_species != "animal":
            return False, "INVALID_SPECIES", metrics

        # 2. Confidence threshold
        if confidence < self.min_confidence:
            return False, "LOW_CONFIDENCE", metrics

        # 3. Bounding box coordinates validation
        if not bbox or len(bbox) != 4:
            return False, "DEGENERATE_BBOX", metrics

        x1, y1, x2, y2 = [float(v) for v in bbox]

        # Inverted or zero/negative dimensions
        if x2 <= x1 or y2 <= y1:
            return False, "INVALID_COORDINATES", metrics

        # Clamp normalized coordinates to [0.0, 1.0]
        x1 = max(0.0, min(1.0, x1))
        y1 = max(0.0, min(1.0, y1))
        x2 = max(0.0, min(1.0, x2))
        y2 = max(0.0, min(1.0, y2))

        w = x2 - x1
        h = y2 - y1
        area = w * h
        aspect_ratio = w / max(h, 1e-4)

        metrics["bbox_area"] = round(area, 5)
        metrics["aspect_ratio"] = round(aspect_ratio, 3)

        # 4. Degenerate Area Check
        if area < self.min_bbox_area:
            return False, "DEGENERATE_BBOX_TOO_SMALL", metrics
        if area > self.max_bbox_area:
            return False, "DEGENERATE_BBOX_TOO_LARGE", metrics

        # 5. Extreme Aspect Ratio Check
        if aspect_ratio < self.min_aspect_ratio or aspect_ratio > self.max_aspect_ratio:
            return False, "EXTREME_ASPECT_RATIO", metrics

        # 6. Crop Image Quality Screening (Blur & Illumination)
        if crop_bgr is not None and crop_bgr.size > 0:
            try:
                # Convert to grayscale for sharpness analysis
                if len(crop_bgr.shape) == 3:
                    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
                else:
                    gray = crop_bgr

                # Laplacian variance (standard measure of edge sharpness / blur)
                lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
                metrics["blur_score"] = round(float(lap_var), 2)

                # Mean brightness
                mean_val = float(np.mean(gray))
                metrics["mean_intensity"] = round(mean_val, 2)

                # Flag if image is excessively blurry and confidence isn't exceptionally high
                if lap_var < self.min_blur_score and confidence < 0.70:
                    return False, "HIGH_BLUR", metrics

                # Flag extreme under or over exposure
                if mean_val < self.min_intensity:
                    return False, "POOR_ILLUMINATION_DARK", metrics
                if mean_val > self.max_intensity:
                    return False, "POOR_ILLUMINATION_OVEREXPOSED", metrics

            except Exception as e:
                logger.debug(f"Image quality screening skipped on crop: {e}")

        return True, "PASSED", metrics

    def sanitize_payload(
        self,
        raw_data: Dict[str, Any],
        crop_bgr: Optional[np.ndarray] = None
    ) -> Dict[str, Any]:
        """
        Strips unwanted multi-megabyte frame dumps and creates a clean, uniform
        dictionary optimized for database storage and pipeline model ingestion.
        """
        # Ensure ID and Timestamp
        rec_id = raw_data.get("id") or f"res_{uuid.uuid4().hex[:10]}"
        timestamp = raw_data.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Coordinates
        raw_bbox = raw_data.get("bbox", [0.0, 0.0, 0.0, 0.0])
        if isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) == 4:
            x1 = round(max(0.0, min(1.0, float(raw_bbox[0]))), 4)
            y1 = round(max(0.0, min(1.0, float(raw_bbox[1]))), 4)
            x2 = round(max(0.0, min(1.0, float(raw_bbox[2]))), 4)
            y2 = round(max(0.0, min(1.0, float(raw_bbox[3]))), 4)
        else:
            x1, y1, x2, y2 = 0.0, 0.0, 0.0, 0.0

        w = max(0.0, x2 - x1)
        h = max(0.0, y2 - y1)
        bbox_area = round(w * h, 5)
        aspect_ratio = round(w / max(h, 1e-4), 3)

        species = str(raw_data.get("species") or "unknown").strip().lower()
        confidence = round(float(raw_data.get("confidence", 0.0)), 4)

        # Stage 2 attribute sanitization
        attrs = raw_data.get("attributes") or {}
        if not isinstance(attrs, dict):
            attrs = {}

        age = str(attrs.get("age") or "unknown")
        age_range = str(attrs.get("age_range") or "unknown")
        sex = str(attrs.get("sex") or "unknown").lower()
        body_size = str(attrs.get("body_size") or "unknown")
        weight_range = str(attrs.get("weight_range") or "unknown")
        behaviour = str(attrs.get("behaviour") or "unknown")
        attr_conf = round(float(attrs.get("confidence", 0.0)), 3)

        # Evaluate validity
        is_valid, filter_reason, eval_metrics = self.evaluate_detection(
            bbox=[x1, y1, x2, y2],
            confidence=confidence,
            species=species,
            crop_bgr=crop_bgr
        )

        # If already flagged by caller
        if "is_valid" in raw_data and not raw_data["is_valid"]:
            is_valid = False
            filter_reason = raw_data.get("filter_reason") or "MANUALLY_FLAGGED"

        # Generate or sanitize media thumbnail (never store full frames)
        media_ref = raw_data.get("media_ref") or ""
        if crop_bgr is not None and crop_bgr.size > 0 and not media_ref:
            try:
                # Resize thumbnail if too large to save DB space
                ch, cw = crop_bgr.shape[:2]
                max_dim = 160
                if ch > max_dim or cw > max_dim:
                    scale = max_dim / max(ch, cw)
                    tw, th = int(cw * scale), int(ch * scale)
                    thumb_img = cv2.resize(crop_bgr, (tw, th), interpolation=cv2.INTER_AREA)
                else:
                    thumb_img = crop_bgr

                _, buf = cv2.imencode(".jpg", thumb_img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                import base64
                media_ref = f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"
            except Exception as e:
                logger.debug(f"Thumbnail encoding skipped: {e}")

        # Location sanitization
        lat = float(raw_data.get("lat", 29.5312)) if raw_data.get("lat") is not None else 29.5312
        lng = float(raw_data.get("lng", 78.7744)) if raw_data.get("lng") is not None else 78.7744
        loc_name = str(raw_data.get("location_name") or "Corbett Reserve Sector")

        # Compact raw metadata for pipeline model without unneeded fields
        metadata = {
            "details": attrs.get("details", ""),
            "quality_flags": attrs.get("quality_flags", []),
            "eval_metrics": eval_metrics
        }

        return {
            "id": rec_id,
            "timestamp": timestamp,
            "source_type": str(raw_data.get("source_type") or "live"),
            "species": species,
            "confidence": confidence,
            "bbox_x1": x1,
            "bbox_y1": y1,
            "bbox_x2": x2,
            "bbox_y2": y2,
            "bbox_area": bbox_area,
            "aspect_ratio": aspect_ratio,
            "track_id": int(raw_data.get("track_id")) if raw_data.get("track_id") is not None else None,
            "is_locked": 1 if raw_data.get("is_locked") else 0,
            "age": age,
            "age_range": age_range,
            "sex": sex,
            "body_size": body_size,
            "weight_range": weight_range,
            "behaviour": behaviour,
            "attribute_confidence": attr_conf,
            "image_quality_score": eval_metrics.get("image_quality_score", 0.8),
            "blur_score": eval_metrics.get("blur_score", 0.0) or 0.0,
            "is_valid": 1 if is_valid else 0,
            "filter_reason": filter_reason,
            "lat": lat,
            "lng": lng,
            "location_name": loc_name,
            "media_ref": media_ref,
            "model_version": str(raw_data.get("model_version") or "yolo11s-stage1+stage2_rules"),
            "raw_metadata": json.dumps(metadata),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }


# Singleton instance
false_detection_manager = FalseDetectionManager()
