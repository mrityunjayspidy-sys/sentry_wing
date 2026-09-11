"""
Unit test for the SentryWing backend pipeline.
Tests config, real inference (detection + attribute engine), and tracker.
"""

import numpy as np
import cv2

from config import config
from inference import (
    load_detector,
    load_attribute_model,
    run_detection,
    run_attributes,
    Detection,
    AttributeResult,
    inference_engine,
)
from tracker import TargetTracker


def test_config():
    print("Testing config...")
    assert config.PORT == 8000
    assert config.LOCK_LOST_THRESHOLD == 10
    assert config.CENTER_DEADBAND > 0
    assert config.CONFIDENCE_THRESHOLD == 0.25
    assert config.IOU_THRESHOLD == 0.45
    assert config.ANIMAL_CLASSES == [
        "tiger", "cheetah", "lion", "hyena",
        "leopard", "bear", "fox", "elephant",
    ]
    print("[PASS] Config loaded successfully.")


def test_detector_loading():
    print("Testing detector loading...")
    det_type = load_detector()
    attr_type = load_attribute_model()
    print(f"  Detector type: {det_type}")
    print(f"  Attribute type: {attr_type}")
    assert attr_type == "rule_engine"

    if det_type == "none":
        print("  [INFO] No detector.pt / detector.onnx found in models/.")
        print("         Drop your trained SentryWing weights there to enable real detection.")
    else:
        assert det_type in ("yolo_pt", "yolo_onnx")
        print(f"  Model classes: {inference_engine.detector_model.names}")
    print("[PASS] Detector loading verified.")


def test_detection_without_model():
    """When no model is loaded, run_detection should return empty list."""
    if inference_engine.detector_type == "none":
        print("Testing detection with no model (should return empty)...")
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        dets = run_detection(frame)
        assert isinstance(dets, list)
        assert len(dets) == 0
        print("[PASS] Empty detection list returned correctly.")
    else:
        print("Testing detection with loaded model...")
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.rectangle(frame, (200, 150), (400, 350), (0, 255, 0), -1)
        dets = run_detection(frame)
        assert isinstance(dets, list)
        print(f"  Got {len(dets)} detection(s) on synthetic frame")
        for d in dets:
            assert len(d.bbox) == 4
            print(f"    {d.class_name} conf={d.confidence} bbox={d.bbox}")
        print("[PASS] Detection on real model verified.")


def test_attribute_engine():
    """Test the Stage 2 rule-based attribute engine with synthetic crops."""
    print("Testing Stage 2 rule-based attribute engine...")

    # Create a synthetic animal crop (300x200 pixels)
    crop = np.random.randint(80, 180, (200, 300, 3), dtype=np.uint8)

    for species in ["tiger", "lion", "elephant", "fox"]:
        attr = run_attributes(
            crop, class_name=species,
            bbox_w_px=300, bbox_h_px=200,
            img_w=640, img_h=480,
        )
        assert isinstance(attr, AttributeResult)
        assert attr.age != "unknown"
        assert attr.sex in ("male", "female")
        assert attr.body_size in ("small", "medium", "large")
        assert attr.weight_range != ""
        assert attr.behaviour != ""
        assert 0.0 < attr.confidence <= 1.0
        print(f"  {species}: age={attr.age}, sex={attr.sex}, "
              f"size={attr.body_size} ({attr.weight_range}), "
              f"behaviour={attr.behaviour}, conf={attr.confidence}")
    
    print("[PASS] Rule-based attribute engine verified.")


def test_tracking_and_locking():
    print("Testing TargetTracker (locking, direction, timeout)...")
    tracker = TargetTracker()

    # Auto-lock on first detection
    d1 = Detection(id=1, bbox=[0.45, 0.45, 0.55, 0.55], class_name="tiger", confidence=0.9)
    status, locked_det = tracker.update([d1])
    assert status.locked is True
    assert status.predicted is False
    assert status.state == "LOCKED"
    assert status.direction == "CENTERED"
    print(f"  Auto-lock: State={status.state}, Direction={status.direction}")

    # Move target to top-right
    d_tr = Detection(id=1, bbox=[0.70, 0.10, 0.90, 0.30], class_name="tiger", confidence=0.9)
    status, _ = tracker.update([d_tr])
    assert status.locked is True
    assert status.predicted is False
    assert status.direction == "UP_RIGHT"
    print(f"  Top-Right: Direction={status.direction}, dx={status.dx}, dy={status.dy}")

    # Lock-loss grace period (10 frames of no detections holding predicted position)
    for i in range(1, config.LOCK_LOST_THRESHOLD + 1):
        status, _ = tracker.update([])
        assert status.locked is True
        assert status.predicted is True
        assert status.state == "LOST"

    # Frame 11: lock dropped
    status, _ = tracker.update([])
    assert status.locked is False
    assert status.predicted is False
    assert status.state == "SEARCHING"
    print(f"  Lock-loss after {config.LOCK_LOST_THRESHOLD} grace frames: State={status.state}")

    print("[PASS] TargetTracker logic verified.")


if __name__ == "__main__":
    test_config()
    test_detector_loading()
    test_detection_without_model()
    test_attribute_engine()
    test_tracking_and_locking()
    print("\nALL BACKEND TESTS PASSED! [OK]")
