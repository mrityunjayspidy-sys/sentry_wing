"""
Unit test for Stage 3 Dosage Engine and Database Persistence.
"""
import os
import sys

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dosage import run_dosage, get_dosage_engine
import database as db

def test_dosage_engine():
    print("\n--- Testing Stage 3 Dosage Engine ---")
    engine = get_dosage_engine()
    print(f"Engine status: mode={engine.model_type}, model_loaded={engine.is_loaded}")

    # Test 1: Tiger, adult, healthy, 190kg
    res_tiger = run_dosage("tiger", "adult", {"condition": "healthy"}, weight_estimate=190.0)
    print(f"\n[Test 1] Tiger (adult, 190kg, healthy):")
    print(f"  Drug: {res_tiger.drug_recommendation}")
    print(f"  Dosage: {res_tiger.dosage_mg} mg ({res_tiger.dosage_per_kg} mg/kg)")
    print(f"  Confidence: {res_tiger.confidence * 100:.1f}%")
    print(f"  Notes: {res_tiger.notes}")
    assert res_tiger.drug_recommendation != ""
    assert res_tiger.dosage_mg > 0

    # Test 2: Tiger, juvenile, impaired, no weight estimate (should use fallback weight)
    res_tiger_juv = run_dosage("tiger", "juvenile", {"condition": "injured", "symptom": "limping"})
    print(f"\n[Test 2] Tiger (juvenile, impaired/injured, fallback weight):")
    print(f"  Drug: {res_tiger_juv.drug_recommendation}")
    print(f"  Dosage: {res_tiger_juv.dosage_mg} mg ({res_tiger_juv.dosage_per_kg} mg/kg)")
    print(f"  Notes: {res_tiger_juv.notes}")
    assert res_tiger_juv.dosage_mg < res_tiger.dosage_mg

    # Test 3: Asian Elephant, adult, 3800kg
    res_elephant = run_dosage("elephant", "adult", "healthy", weight_estimate=3800.0)
    print(f"\n[Test 3] Elephant (adult, 3800kg):")
    print(f"  Drug: {res_elephant.drug_recommendation}")
    print(f"  Dosage: {res_elephant.dosage_mg} mg ({res_elephant.dosage_per_kg} mg/kg)")
    print(f"  Notes: {res_elephant.notes}")
    assert "Xylazine" in res_elephant.drug_recommendation or "Etorphine" in res_elephant.drug_recommendation
    assert res_elephant.dosage_mg > 0

    # Test 4: Unknown / wild dog
    res_unknown = run_dosage("wild_canid", "subadult", "normal", weight_estimate=25.0)
    print(f"\n[Test 4] Wild Canid (unknown fallback):")
    print(f"  Drug: {res_unknown.drug_recommendation}")
    print(f"  Dosage: {res_unknown.dosage_mg} mg")
    assert res_unknown.dosage_mg > 0

    print("\n[OK] Stage 3 Dosage Engine unit tests PASSED!")

def test_database_persistence():
    print("\n--- Testing Database Migration & Persistence with Stage 3 Dosage ---")
    db.init_db()

    # Insert a test detection with dosage
    inserted = db.insert_detection({
        "species": "tiger",
        "confidence": 0.96,
        "source_type": "photo",
        "source_id": "test_cam_01",
        "attributes": {
            "age": "adult",
            "weight_estimate": "195 kg",
            "health_status": "healthy"
        },
        "drug_recommendation": "Ketamine (100mg/mL) + Medetomidine (1mg/mL)",
        "dosage_mg": 780.0,
        "dosage_per_kg": 4.0,
        "dosage_confidence": 0.88,
        "dosage_notes": "Administer via deep IM jab stick or 3mL Dan-Inject dart. Reverse with Atipamezole (5mg/mg Medetomidine) IM/IV after 45-60 min."
    })
    det_id = inserted["id"]
    print(f"Inserted test detection ID: {det_id}")

    # Fetch detection by ID
    det = db.get_detection_by_id(det_id)
    assert det is not None
    print(f"Fetched detection: species={det['species']}, drug={det.get('drug_recommendation')}, dosage_mg={det.get('dosage_mg')}")
    assert det.get("drug_recommendation") == "Ketamine (100mg/mL) + Medetomidine (1mg/mL)"
    assert det.get("dosage_mg") == 780.0
    assert det.get("dosage_per_kg") == 4.0
    assert det.get("dosage_confidence") == 0.88
    assert "Atipamezole" in det.get("dosage_notes", "")

    # Test notification insertion with dosage
    inserted_notif = db.insert_notification({
        "detection_id": det_id,
        "recipient_role": "vet",
        "species": "tiger",
        "message": f"Unit Test: Adult tiger spotted with recommended dart dosage: {det.get('drug_recommendation')}",
        "dosage": {
            "drug": det.get("drug_recommendation"),
            "dosage_mg": det.get("dosage_mg"),
            "dosage_per_kg": det.get("dosage_per_kg"),
            "confidence": det.get("dosage_confidence"),
            "notes": det.get("dosage_notes")
        }
    })
    notif_id = inserted_notif["id"]
    print(f"Inserted test notification ID: {notif_id}")
    notifs = db.get_notifications(role="vet", limit=5)
    matching_notif = next((n for n in notifs if n["id"] == notif_id), None)
    assert matching_notif is not None
    assert matching_notif.get("dosage") is not None
    assert matching_notif["dosage"]["dosage_mg"] == 780.0
    print(f"Fetched notification dosage: {matching_notif['dosage']}")

    print("\n[OK] Database Persistence tests PASSED!")

if __name__ == "__main__":
    test_dosage_engine()
    test_database_persistence()
