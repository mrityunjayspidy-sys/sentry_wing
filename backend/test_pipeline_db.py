"""
Unit tests for Model Results Database Table, False Detection Manager,
and Pipeline Model Data Access.
"""

import os
import time
import numpy as np
import cv2

import database as db
from false_detection_manager import FalseDetectionManager, false_detection_manager


def test_false_detection_filtering():
    print("Testing FalseDetectionManager screening rules...")
    mgr = FalseDetectionManager(min_confidence=0.35)

    # 1. Clean valid detection
    valid, reason, m = mgr.evaluate_detection(
        bbox=[0.2, 0.2, 0.5, 0.6],
        confidence=0.88,
        species="tiger"
    )
    assert valid is True
    assert reason == "PASSED"
    print("  [PASS] Valid detection passed filter.")

    # 2. Low confidence
    valid, reason, m = mgr.evaluate_detection(
        bbox=[0.2, 0.2, 0.5, 0.6],
        confidence=0.20,
        species="tiger"
    )
    assert valid is False
    assert reason == "LOW_CONFIDENCE"
    print("  [PASS] Low confidence rejected.")

    # 3. Degenerate tiny bounding box
    valid, reason, m = mgr.evaluate_detection(
        bbox=[0.2, 0.2, 0.21, 0.21], # area = 0.01 * 0.01 = 0.0001
        confidence=0.90,
        species="tiger"
    )
    assert valid is False
    assert reason == "DEGENERATE_BBOX_TOO_SMALL"
    print("  [PASS] Tiny degenerate box rejected.")

    # 4. Extreme aspect ratio (very wide horizon artifact)
    valid, reason, m = mgr.evaluate_detection(
        bbox=[0.05, 0.45, 0.95, 0.46], # w=0.9, h=0.01 -> aspect ratio = 90
        confidence=0.85,
        species="tiger"
    )
    assert valid is False
    assert reason == "EXTREME_ASPECT_RATIO"
    print("  [PASS] Extreme aspect ratio rejected.")

    # 5. Invalid / unknown species
    valid, reason, m = mgr.evaluate_detection(
        bbox=[0.2, 0.2, 0.5, 0.6],
        confidence=0.90,
        species="flying_saucer"
    )
    assert valid is False
    assert reason == "INVALID_SPECIES"
    print("  [PASS] Invalid species rejected.")

    # 6. Blurry image crop
    blurry_crop = np.full((100, 100, 3), 128, dtype=np.uint8) # Completely uniform -> zero Laplacian variance
    valid, reason, m = mgr.evaluate_detection(
        bbox=[0.2, 0.2, 0.5, 0.6],
        confidence=0.55,
        species="leopard",
        crop_bgr=blurry_crop
    )
    assert valid is False
    assert reason == "HIGH_BLUR"
    print("  [PASS] Blurry crop rejected.")


def test_database_model_results_lifecycle():
    print("\nTesting model_results database lifecycle...")
    db.init_db()

    # Clear prior test entries if any
    db.purge_unwanted_model_results(purge_all_invalid=True)

    # 1. Insert a clean valid model result
    valid_record = {
        "source_type": "live",
        "species": "tiger",
        "confidence": 0.92,
        "bbox": [0.25, 0.30, 0.65, 0.70],
        "attributes": {
            "age": "adult (4–10 years)",
            "age_range": "4–10 years",
            "sex": "Female",
            "body_size": "Large",
            "weight_range": "160–250 kg",
            "behaviour": "walking / traversing",
            "confidence": 0.88
        },
        "lat": 29.5312,
        "lng": 78.7744,
        "location_name": "Trail 4 North Sector",
        "track_id": 101,
        "is_locked": 1
    }
    saved_valid = db.insert_model_result(valid_record, auto_filter=True)
    assert saved_valid["is_valid"] == 1
    assert saved_valid["filter_reason"] == "PASSED"
    print(f"  [PASS] Clean model result stored: {saved_valid['id']}")

    # 2. Insert a false detection (low confidence phantom)
    phantom_record = {
        "source_type": "live",
        "species": "elephant",
        "confidence": 0.18, # Below threshold
        "bbox": [0.1, 0.1, 0.4, 0.5],
        "attributes": {},
        "location_name": "Trail 4 North Sector"
    }
    saved_phantom = db.insert_model_result(phantom_record, auto_filter=True)
    assert saved_phantom["is_valid"] == 0
    assert saved_phantom["filter_reason"] == "LOW_CONFIDENCE"
    print(f"  [PASS] Phantom detection flagged as false: {saved_phantom['id']} ({saved_phantom['filter_reason']})")

    # 3. Query for pipeline model (is_valid=True)
    pipeline_results = db.get_model_results(is_valid=True)
    assert any(r["id"] == saved_valid["id"] for r in pipeline_results)
    assert not any(r["id"] == saved_phantom["id"] for r in pipeline_results)
    print(f"  [PASS] Pipeline query returned {len(pipeline_results)} clean valid results (false detection excluded).")

    # 4. Check stats
    stats = db.get_model_results_stats()
    assert stats["valid_count"] >= 1
    assert stats["false_detection_count"] >= 1
    assert "LOW_CONFIDENCE" in stats["rejection_reasons"]
    print(f"  [PASS] Pipeline stats verified: {stats}")

    # 5. Purge unwanted false detections
    purged = db.purge_unwanted_model_results(purge_all_invalid=True)
    assert purged >= 1
    remaining_phantoms = [r for r in db.get_model_results(is_valid=False) if r["id"] == saved_phantom["id"]]
    assert len(remaining_phantoms) == 0

    # Ensure valid detection was preserved
    still_valid = db.get_model_result_by_id(saved_valid["id"])
    assert still_valid is not None
    assert still_valid["is_valid"] == 1
    print(f"  [PASS] Unwanted false detections successfully purged ({purged} rows removed, valid retained).")


if __name__ == "__main__":
    test_false_detection_filtering()
    test_database_model_results_lifecycle()
    print("\nALL MODEL RESULTS & FALSE DETECTION TESTS PASSED! [OK]")
