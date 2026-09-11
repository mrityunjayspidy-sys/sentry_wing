"""
Tracker module for Animal Target Locking & Direction Vector Derivation.
Maintains lock state across frames, matches targets via centroid distance and IoU,
derives 8-way discrete pan/tilt commands, computes normalized offsets (-1..1),
and produces decoupled Phase 2 hardware servo angles.
"""

import math
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, asdict

from config import config
from inference import Detection, AttributeResult


def compute_iou(boxA: List[float], boxB: List[float]) -> float:
    """Computes Intersection over Union (IoU) between two normalized boxes [x1, y1, x2, y2]."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    inter_w = max(0.0, xB - xA)
    inter_h = max(0.0, yB - yA)
    inter_area = inter_w * inter_h

    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    union_area = areaA + areaB - inter_area

    if union_area <= 0.0:
        return 0.0
    return inter_area / union_area


def compute_centroid(box: List[float]) -> Tuple[float, float]:
    """Returns normalized centroid (cx, cy) of box [x1, y1, x2, y2]."""
    cx = (box[0] + box[2]) / 2.0
    cy = (box[1] + box[3]) / 2.0
    return cx, cy


def euclidean_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Computes Euclidean distance between two 2D points."""
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


@dataclass
class HardwareCommand:
    """
    Decoupled hardware command structure for Phase 2 ESP32-CAM & Pan/Tilt Servos.
    Allows swapping video source and actuator destination without changing tracker logic.
    """
    pan_angle: float        # Absolute target servo pan angle (0.0 to 180.0 degrees)
    tilt_angle: float       # Absolute target servo tilt angle (0.0 to 180.0 degrees)
    pan_delta: float        # Incremental step (-1.0 to 1.0)
    tilt_delta: float       # Incremental step (-1.0 to 1.0)
    action: str             # "HOLD", "TRACK_SERVO", "SEARCH_SWEEP"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TrackingStatus:
    locked: bool
    state: str              # "SEARCHING", "LOCKED", "LOST"
    target_id: Optional[int]
    target_class: Optional[str]
    target_bbox: Optional[List[float]]
    target_center: Optional[Tuple[float, float]]
    dx: float               # Normalized offset from center: -1.0 (Left) to +1.0 (Right)
    dy: float               # Normalized offset from center: -1.0 (Up/Top) to +1.0 (Down/Bottom)
    direction: str          # "CENTERED", "UP", "DOWN", "LEFT", "RIGHT", "UP_LEFT", "UP_RIGHT", "DOWN_LEFT", "DOWN_RIGHT"
    lost_count: int
    max_lost_threshold: int
    match_score: float
    hardware_command: HardwareCommand
    predicted: bool = False # True when holding lock via motion prediction during occlusion

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["hardware_command"] = self.hardware_command.to_dict()
        d["bbox"] = self.target_bbox  # Guaranteed bbox field
        return d


class MotionPredictor:
    """
    Abstract base interface for target motion prediction across frames.
    Enables drop-in replacement with a Kalman filter or Particle filter without modifying tracker core.
    """
    def reset(self):
        pass

    def update(self, bbox: List[float], timestamp: Optional[float] = None):
        """Updates predictor with a confirmed detection bbox [x1, y1, x2, y2]."""
        raise NotImplementedError

    def predict(self) -> Tuple[List[float], Tuple[float, float]]:
        """Predicts the next expected bbox [x1, y1, x2, y2] and centroid (cx, cy)."""
        raise NotImplementedError

    def step_grace(self) -> Tuple[List[float], Tuple[float, float]]:
        """Advances prediction during missed detection frame (with velocity damping)."""
        raise NotImplementedError


class LinearVelocityPredictor(MotionPredictor):
    """
    Linear motion predictor using smoothed recent centroid velocities and box dimensions.
    Computes per-frame velocity vector (vx, vy) from the last N confirmed positions.
    Applies damping during occlusion grace frames to prevent trajectory explosion.
    """
    def __init__(self, history_size: int = config.VELOCITY_HISTORY_FRAMES, damping: float = config.VELOCITY_DAMPING):
        self.history_size = max(2, history_size)
        self.damping = damping
        self.history: List[Tuple[List[float], Tuple[float, float], Optional[float]]] = []
        self.vx: float = 0.0
        self.vy: float = 0.0
        self.last_bbox: Optional[List[float]] = None
        self.last_centroid: Optional[Tuple[float, float]] = None

    def reset(self):
        self.history.clear()
        self.vx = 0.0
        self.vy = 0.0
        self.last_bbox = None
        self.last_centroid = None

    def update(self, bbox: List[float], timestamp: Optional[float] = None):
        cx, cy = compute_centroid(bbox)
        if len(self.history) > 0:
            # Multi-frame smoothed velocity estimation from baseline in window
            oldest_box, oldest_c, _ = self.history[0]
            steps = len(self.history)
            raw_vx = (cx - oldest_c[0]) / float(steps)
            raw_vy = (cy - oldest_c[1]) / float(steps)

            # Clamp per-frame velocity (max 0.20 normalized frame dimension per frame)
            max_vel = 0.20
            self.vx = max(-max_vel, min(max_vel, raw_vx))
            self.vy = max(-max_vel, min(max_vel, raw_vy))
        else:
            self.vx = 0.0
            self.vy = 0.0

        if len(self.history) >= self.history_size:
            self.history.pop(0)
        self.history.append((bbox.copy(), (cx, cy), timestamp))
        self.last_bbox = bbox.copy()
        self.last_centroid = (cx, cy)

    def predict(self) -> Tuple[List[float], Tuple[float, float]]:
        if self.last_bbox is None or self.last_centroid is None:
            return ([0.4, 0.4, 0.6, 0.6], (0.5, 0.5))

        cx, cy = self.last_centroid
        w = max(0.02, self.last_bbox[2] - self.last_bbox[0])
        h = max(0.02, self.last_bbox[3] - self.last_bbox[1])

        # Extrapolate centroid clamped to valid bounds
        pred_cx = max(w / 2.0, min(1.0 - w / 2.0, cx + self.vx))
        pred_cy = max(h / 2.0, min(1.0 - h / 2.0, cy + self.vy))

        # Reconstruct bbox centered at predicted point
        pred_x1 = max(0.0, pred_cx - w / 2.0)
        pred_y1 = max(0.0, pred_cy - h / 2.0)
        pred_x2 = min(1.0, pred_x1 + w)
        pred_y2 = min(1.0, pred_y1 + h)

        pred_bbox = [round(pred_x1, 4), round(pred_y1, 4), round(pred_x2, 4), round(pred_y2, 4)]
        pred_centroid = (round(pred_cx, 4), round(pred_cy, 4))
        return pred_bbox, pred_centroid

    def step_grace(self) -> Tuple[List[float], Tuple[float, float]]:
        """Advances prediction one frame ahead during occlusion and damps velocity."""
        pred_bbox, pred_centroid = self.predict()
        self.last_bbox = pred_bbox
        self.last_centroid = pred_centroid
        # Apply damping so unobserved motion gradually slows down
        self.vx *= self.damping
        self.vy *= self.damping
        return pred_bbox, pred_centroid


class TargetTracker:
    """
    Target Tracker & Locking Controller.
    Manages lock lifecycle, matching, spatial offset calculation, and servo telemetry.
    """
    def __init__(self, predictor: Optional[MotionPredictor] = None):
        self.is_locked: bool = False
        self.locked_id: Optional[int] = None
        self.locked_class: Optional[str] = None
        self.last_bbox: Optional[List[float]] = None
        self.last_centroid: Optional[Tuple[float, float]] = None
        self.lost_frames: int = 0
        self.auto_lock: bool = True  # Automatically lock onto first detected animal if none locked
        
        # Motion predictor (defaults to LinearVelocityPredictor; can be swapped with KalmanFilter)
        self.predictor: MotionPredictor = predictor if predictor is not None else LinearVelocityPredictor()

        # Virtual servo state (Pan: 90 deg center, Tilt: 90 deg center)
        self.current_pan_angle: float = config.SERVO_PAN_DEFAULT
        self.current_tilt_angle: float = config.SERVO_TILT_DEFAULT

    def set_auto_lock(self, enabled: bool):
        self.auto_lock = enabled

    def manual_lock_target(self, target_id: Optional[int] = None, norm_x: Optional[float] = None, norm_y: Optional[float] = None, detections: Optional[List[Detection]] = None):
        """
        Locks onto a specific target ID or nearest detection to tap coordinates (norm_x, norm_y).
        """
        if detections is None:
            return

        # Lock by ID
        if target_id is not None:
            for d in detections:
                if d.id == target_id:
                    self._acquire_lock(d)
                    return

        # Lock by screen tap coordinate (norm_x, norm_y in 0..1)
        if norm_x is not None and norm_y is not None:
            best_det = None
            min_dist = float("inf")
            for d in detections:
                # Check if point inside bbox
                x1, y1, x2, y2 = d.bbox
                if x1 <= norm_x <= x2 and y1 <= norm_y <= y2:
                    self._acquire_lock(d)
                    return
                # Otherwise find closest centroid
                cx, cy = compute_centroid(d.bbox)
                dist = euclidean_distance((cx, cy), (norm_x, norm_y))
                if dist < min_dist:
                    min_dist = dist
                    best_det = d
                    
            if best_det is not None and min_dist < 0.40:
                self._acquire_lock(best_det)

    def manual_unlock(self):
        """Drops target lock and resets to searching state."""
        self.is_locked = False
        self.locked_id = None
        self.locked_class = None
        self.last_bbox = None
        self.last_centroid = None
        self.lost_frames = 0
        self.predictor.reset()

    def _acquire_lock(self, detection: Detection):
        self.is_locked = True
        self.locked_id = detection.id
        self.locked_class = detection.class_name
        self.last_bbox = detection.bbox.copy()
        self.last_centroid = compute_centroid(detection.bbox)
        self.lost_frames = 0
        self.predictor.reset()
        self.predictor.update(detection.bbox)

    def _derive_direction_and_offset(self, cx: float, cy: float) -> Tuple[float, float, str]:
        """
        Computes normalized offset (dx, dy) where (0.0, 0.0) is center,
        and derives discrete 8-way direction command.
        
        Coordinate System:
          cx: 0.0 (left) to 1.0 (right)   -> dx: -1.0 (left) to +1.0 (right)
          cy: 0.0 (top) to 1.0 (bottom)   -> dy: -1.0 (up) to +1.0 (down)
        """
        dx = (cx - 0.5) * 2.0
        dy = (cy - 0.5) * 2.0
        
        # Clamp to [-1.0, 1.0]
        dx = max(-1.0, min(1.0, dx))
        dy = max(-1.0, min(1.0, dy))
        
        deadband = config.CENTER_DEADBAND
        
        x_dir = ""
        if dx > deadband:
            x_dir = "RIGHT"
        elif dx < -deadband:
            x_dir = "LEFT"
            
        y_dir = ""
        if dy > deadband:
            y_dir = "DOWN"
        elif dy < -deadband:
            y_dir = "UP"
            
        if not x_dir and not y_dir:
            direction = "CENTERED"
        elif x_dir and not y_dir:
            direction = x_dir
        elif y_dir and not x_dir:
            direction = y_dir
        else:
            direction = f"{y_dir}_{x_dir}"  # e.g., UP_LEFT, UP_RIGHT, DOWN_LEFT, DOWN_RIGHT
            
        return round(dx, 4), round(dy, 4), direction

    def _calculate_hardware_servo_command(self, dx: float, dy: float, direction: str) -> HardwareCommand:
        """
        Calculates Phase 2 servo angles and tracking delta for ESP32-CAM gimbal.
        Pan servo moves horizontally, Tilt servo moves vertically.
        """
        if not self.is_locked:
            return HardwareCommand(
                pan_angle=self.current_pan_angle,
                tilt_angle=self.current_tilt_angle,
                pan_delta=0.0,
                tilt_delta=0.0,
                action="SEARCH_SWEEP"
            )

        # Proportional servo control
        p_gain = config.SERVO_P_GAIN
        pan_step = dx * p_gain
        tilt_step = -dy * p_gain  # Inverting dy so target above center tilts up
        
        new_pan = max(config.SERVO_PAN_MIN, min(config.SERVO_PAN_MAX, self.current_pan_angle + pan_step))
        new_tilt = max(config.SERVO_TILT_MIN, min(config.SERVO_TILT_MAX, self.current_tilt_angle + tilt_step))
        
        self.current_pan_angle = round(new_pan, 1)
        self.current_tilt_angle = round(new_tilt, 1)
        
        return HardwareCommand(
            pan_angle=self.current_pan_angle,
            tilt_angle=self.current_tilt_angle,
            pan_delta=round(pan_step, 2),
            tilt_delta=round(tilt_step, 2),
            action=f"TRACK_{direction}"
        )

    def update(self, detections: List[Detection]) -> Tuple[TrackingStatus, Optional[Detection]]:
        """
        Updates tracking status given current frame detections.
        Predicts expected position using recent velocity, matches candidate detections
        against predicted position via IoU + centroid distance, and maintains lock
        across occlusion grace period (default 10 frames).
        Returns TrackingStatus and the currently locked Detection (or None).
        """
        # Case 1: Currently locked on a target
        if self.is_locked and self.last_bbox is not None:
            # 1. Predict target's expected position for this frame using recent motion
            pred_bbox, pred_centroid = self.predictor.predict()

            best_match: Optional[Detection] = None
            best_score = -1.0

            # 2. Match candidate detections against the PREDICTED position
            for det in detections:
                # (a) IoU score against predicted bbox
                iou = compute_iou(pred_bbox, det.bbox)
                
                # (b) Centroid proximity score against predicted centroid
                det_cx, det_cy = compute_centroid(det.bbox)
                dist = euclidean_distance((det_cx, det_cy), pred_centroid)
                dist_score = max(0.0, 1.0 - (dist / config.MATCH_DISTANCE_THRESHOLD))
                
                # (c) ID match bonus if tracker ID matches
                id_bonus = 0.30 if (self.locked_id is not None and det.id == self.locked_id) else 0.0

                # (d) Combined matching score: weighted IoU + centroid proximity + ID bonus
                combined_score = 0.50 * iou + 0.35 * dist_score + id_bonus
                
                # Match condition: highest score exceeding threshold or matching tracked ID
                if combined_score > best_score and (dist < config.MATCH_DISTANCE_THRESHOLD or iou > 0.10 or det.id == self.locked_id):
                    best_score = combined_score
                    best_match = det

            if best_match is not None:
                # Target successfully matched in this frame
                self.last_bbox = best_match.bbox.copy()
                self.last_centroid = compute_centroid(best_match.bbox)
                self.lost_frames = 0
                best_match.is_locked = True
                self.locked_class = best_match.class_name
                
                # Update predictor with freshly observed detection
                self.predictor.update(best_match.bbox)

                cx, cy = self.last_centroid
                dx, dy, direction = self._derive_direction_and_offset(cx, cy)
                hw_cmd = self._calculate_hardware_servo_command(dx, dy, direction)
                
                status = TrackingStatus(
                    locked=True,
                    state="LOCKED",
                    target_id=self.locked_id,
                    target_class=self.locked_class,
                    target_bbox=self.last_bbox,
                    target_center=(round(cx, 4), round(cy, 4)),
                    dx=dx,
                    dy=dy,
                    direction=direction,
                    lost_count=0,
                    max_lost_threshold=config.LOCK_LOST_THRESHOLD,
                    match_score=round(best_score, 3),
                    hardware_command=hw_cmd,
                    predicted=False
                )
                return status, best_match
                
            else:
                # Target not matched in this frame (occlusion, motion blur, or target exit)
                self.lost_frames += 1
                
                if self.lost_frames <= config.LOCK_LOST_THRESHOLD:
                    # GRACE PERIOD: keep lock alive using the predicted position
                    pred_bbox, pred_centroid = self.predictor.step_grace()
                    self.last_bbox = pred_bbox
                    self.last_centroid = pred_centroid
                    
                    cx, cy = pred_centroid
                    dx, dy, direction = self._derive_direction_and_offset(cx, cy)
                    hw_cmd = self._calculate_hardware_servo_command(dx, dy, direction)
                    
                    status = TrackingStatus(
                        locked=True,
                        state="LOST",
                        target_id=self.locked_id,
                        target_class=self.locked_class,
                        target_bbox=self.last_bbox,
                        target_center=(round(cx, 4), round(cy, 4)),
                        dx=dx,
                        dy=dy,
                        direction=direction,
                        lost_count=self.lost_frames,
                        max_lost_threshold=config.LOCK_LOST_THRESHOLD,
                        match_score=0.0,
                        hardware_command=hw_cmd,
                        predicted=True
                    )
                    return status, None
                else:
                    # Grace period expired with no re-match: declare lock lost and return to SEARCHING
                    self.manual_unlock()
                    hw_cmd = self._calculate_hardware_servo_command(0.0, 0.0, "CENTERED")
                    status = TrackingStatus(
                        locked=False,
                        state="SEARCHING",
                        target_id=None,
                        target_class=None,
                        target_bbox=None,
                        target_center=None,
                        dx=0.0,
                        dy=0.0,
                        direction="CENTERED",
                        lost_count=0,
                        max_lost_threshold=config.LOCK_LOST_THRESHOLD,
                        match_score=0.0,
                        hardware_command=hw_cmd,
                        predicted=False
                    )
                    return status, None

        # Case 2: Not currently locked
        else:
            if self.auto_lock and len(detections) > 0:
                # Auto-lock onto first detected animal
                first_target = detections[0]
                self._acquire_lock(first_target)
                first_target.is_locked = True
                
                cx, cy = self.last_centroid or compute_centroid(first_target.bbox)
                dx, dy, direction = self._derive_direction_and_offset(cx, cy)
                hw_cmd = self._calculate_hardware_servo_command(dx, dy, direction)
                
                status = TrackingStatus(
                    locked=True,
                    state="LOCKED",
                    target_id=self.locked_id,
                    target_class=self.locked_class,
                    target_bbox=self.last_bbox,
                    target_center=(round(cx, 4), round(cy, 4)),
                    dx=dx,
                    dy=dy,
                    direction=direction,
                    lost_count=0,
                    max_lost_threshold=config.LOCK_LOST_THRESHOLD,
                    match_score=1.0,
                    hardware_command=hw_cmd,
                    predicted=False
                )
                return status, first_target
                
            else:
                # Searching state
                hw_cmd = self._calculate_hardware_servo_command(0.0, 0.0, "CENTERED")
                status = TrackingStatus(
                    locked=False,
                    state="SEARCHING",
                    target_id=None,
                    target_class=None,
                    target_bbox=None,
                    target_center=None,
                    dx=0.0,
                    dy=0.0,
                    direction="CENTERED",
                    lost_count=0,
                    max_lost_threshold=config.LOCK_LOST_THRESHOLD,
                    match_score=0.0,
                    hardware_command=hw_cmd,
                    predicted=False
                )
                return status, None
