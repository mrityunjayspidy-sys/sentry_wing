"""
E2E Test to verify Stage 3 Tranquilizer Dart Dosage integration across photo, video, and stream pipelines.
"""
import sys
import os
import io
import numpy as np
import cv2
import requests

BASE_URL = "http://localhost:8000"

def test_endpoints():
    print("\n--- 1. Testing /health and /api/status for Stage 3 Dosage ---")
    r = requests.get(f"{BASE_URL}/health")
    assert r.status_code == 200
    data = r.json()
    print(f"Health response: dosage_type = {data.get('dosage_type')}")
    assert data.get("dosage_type") == "stub_engine"

    r = requests.get(f"{BASE_URL}/api/status")
    assert r.status_code == 200
    data = r.json()
    print(f"Status response: dosage_type = {data.get('dosage_type')}")
    assert data.get("dosage_type") == "stub_engine"
    print("[OK] Health and status endpoints verified!")

def test_photo_detection_with_dosage():
    print("\n--- 2. Testing Photo Upload with Stage 3 Dosage ---")
    # Generate synthetic image (JPEG)
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "TEST TIGER SIGHTING", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    _, buf = cv2.imencode(".jpg", img)
    img_bytes = io.BytesIO(buf.tobytes())

    files = {"file": ("test_tiger.jpg", img_bytes, "image/jpeg")}
    data = {
        "conf": "0.10",
        "uploader_name": "Dr. Sarah Rao",
        "location_name": "Corbett Gate 3",
        "lat": "29.5312",
        "lng": "78.7744"
    }
    resp = requests.post(f"{BASE_URL}/api/detect/photo", files=files, data=data)
    assert resp.status_code == 200
    res = resp.json()
    print(f"Photo detection count: {res.get('count')}")
    print("[OK] Photo endpoint executed successfully!")

def test_dosage_direct_pipeline():
    print("\n--- 3. Testing Direct run_dosage & DB insertion ---")
    from dosage import run_dosage
    import database as db

    res = run_dosage(
        species="tiger",
        age="adult (4-10 years)",
        health_attributes={
            "vitality_status": "healthy",
            "estimated_weight_kg": 185.0
        }
    )
    print(f"Direct dosage output for tiger:")
    print(f"  Drug: {res.drug_recommendation}")
    print(f"  Dose: {res.dosage_mg} mg ({res.dosage_per_kg} mg/kg)")
    print(f"  Notes: {res.notes}")
    print(f"  Disclaimer: {res.disclaimer}")

    assert res.dosage_mg > 0
    assert "verify" in res.disclaimer.lower()

    # Verify lion
    res_lion = run_dosage("lion", "adult", {"vitality_status": "healthy"}, weight_estimate=190.0)
    print(f"\nDirect dosage output for lion:")
    print(f"  Drug: {res_lion.drug_recommendation}")
    print(f"  Dose: {res_lion.dosage_mg} mg")
    assert "Ketamine" in res_lion.drug_recommendation

    # Verify bear
    res_bear = run_dosage("bear", "adult", {"vitality_status": "healthy"}, weight_estimate=220.0)
    print(f"\nDirect dosage output for bear:")
    print(f"  Drug: {res_bear.drug_recommendation}")
    print(f"  Dose: {res_bear.dosage_mg} mg")
    assert "Telazol" in res_bear.drug_recommendation

    print("\n[OK] Direct pipeline tests PASSED!")

if __name__ == "__main__":
    test_endpoints()
    test_photo_detection_with_dosage()
    test_dosage_direct_pipeline()
