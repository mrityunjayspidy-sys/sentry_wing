"""
Unit test for Continuous Tracking, Velocity Prediction, and Occlusion Grace Period.
"""

from tracker import TargetTracker, LinearVelocityPredictor
from inference import Detection
from config import config

def test_linear_velocity_predictor():
    print("Testing LinearVelocityPredictor...")
    pred = LinearVelocityPredictor(history_size=5, damping=0.88)
    
    # Step 1: Initial detection at center (0.4, 0.4, 0.6, 0.6) -> centroid (0.5, 0.5)
    pred.update([0.4, 0.4, 0.6, 0.6])
    p_box, p_c = pred.predict()
    assert abs(p_c[0] - 0.5) < 1e-4 and abs(p_c[1] - 0.5) < 1e-4
    print("  Initial stationary prediction verified.")
    
    # Step 2: Target moves right and down (+0.04 in x, +0.02 in y per frame)
    pred.update([0.44, 0.42, 0.64, 0.62])
    p_box, p_c = pred.predict()
    assert p_c[0] > 0.54  # Moving right
    assert p_c[1] > 0.52  # Moving down
    print(f"  Velocity extrapolation verified: predicted centroid={p_c}, vx={pred.vx:.4f}, vy={pred.vy:.4f}")
    
    # Step 3: Grace period step
    box_g1, c_g1 = pred.step_grace()
    assert c_g1[0] > p_c[0] or abs(c_g1[0] - p_c[0]) < 1e-3
    print("  Grace step with damping verified.")
    print("[PASS] LinearVelocityPredictor test passed.\n")


def test_continuous_tracking_grace_period():
    print("Testing TargetTracker 10-frame grace period & predicted flag...")
    tracker = TargetTracker()
    
    # 1. Lock onto target moving across screen
    d0 = Detection(id=42, bbox=[0.20, 0.30, 0.30, 0.40], class_name="tiger", confidence=0.92)
    s0, _ = tracker.update([d0])
    assert s0.locked is True
    assert s0.predicted is False
    assert s0.lost_count == 0
    
    d1 = Detection(id=42, bbox=[0.25, 0.30, 0.35, 0.40], class_name="tiger", confidence=0.91)
    s1, _ = tracker.update([d1])
    assert s1.locked is True
    assert s1.predicted is False
    
    # 2. Simulate 10 frames of occlusion / motion blur (empty detections)
    for frame_idx in range(1, config.LOCK_LOST_THRESHOLD + 1):
        status, locked_det = tracker.update([])
        assert status.locked is True, f"Lock dropped prematurely on frame {frame_idx}"
        assert status.predicted is True, f"Predicted flag should be True on missed frame {frame_idx}"
        assert status.lost_count == frame_idx
        assert status.target_bbox is not None
        assert "bbox" in status.to_dict()
        assert status.to_dict()["predicted"] is True
        print(f"  Frame {frame_idx}/{config.LOCK_LOST_THRESHOLD}: locked={status.locked}, predicted={status.predicted}, bbox={status.target_bbox}")
    
    # 3. 11th frame without detection: Grace period expired -> Lock lost
    status_lost, _ = tracker.update([])
    assert status_lost.locked is False
    assert status_lost.state == "SEARCHING"
    assert status_lost.predicted is False
    print("  Frame 11: Grace period expired, lock returned to SEARCHING as expected.")
    
    # 4. Test re-acquisition during grace period
    tracker.update([d0])
    tracker.update([d1])
    # Miss 3 frames
    tracker.update([])
    tracker.update([])
    s_miss3, _ = tracker.update([])
    assert s_miss3.lost_count == 3
    assert s_miss3.predicted is True
    
    # Re-acquire with detection near predicted position
    pred_c = s_miss3.target_center
    d_reacquire = Detection(
        id=42,
        bbox=[pred_c[0] - 0.05, pred_c[1] - 0.05, pred_c[0] + 0.05, pred_c[1] + 0.05],
        class_name="tiger",
        confidence=0.95
    )
    s_recovered, locked_det = tracker.update([d_reacquire])
    assert s_recovered.locked is True
    assert s_recovered.predicted is False
    assert s_recovered.lost_count == 0
    assert locked_det is not None
    print("  Re-acquisition during grace period restored locked state (predicted=False, lost_count=0).")
    print("[PASS] Continuous tracking grace period & recovery verified.\n")


if __name__ == "__main__":
    test_linear_velocity_predictor()
    test_continuous_tracking_grace_period()
    print("ALL CONTINUOUS TRACKING TESTS PASSED SUCCESSFULLY! [OK]")
