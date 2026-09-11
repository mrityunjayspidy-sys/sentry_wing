"""
Configuration module for Animal Detection & Target Locking Backend.
Supports runtime tuning via environment variables or .env file.
"""

import os
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"


class Settings(BaseSettings):
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: list[str] = ["*"]
    
    # Model settings
    MODELS_DIR: Path = MODELS_DIR
    DETECTOR_PT_PATH: Path = MODELS_DIR / "detector.pt"
    DETECTOR_ONNX_PATH: Path = MODELS_DIR / "detector.onnx"
    DOSAGE_JOBLIB_PATH: Path = MODELS_DIR / "dart_dose_model.joblib"
    DOSAGE_ONNX_PATH: Path = MODELS_DIR / "dosage_model.onnx"
    DOSAGE_PT_PATH: Path = MODELS_DIR / "dosage_model.pt"
    
    # YOLO inference settings (matching notebook R04 parameters)
    CONFIDENCE_THRESHOLD: float = 0.25
    IOU_THRESHOLD: float = 0.45
    INPUT_IMAGE_SIZE: int = 640
    
    # Tracking & Locking settings
    LOCK_LOST_THRESHOLD: int = 10          # Consecutive missing frames before lock is dropped (grace period)
    MATCH_DISTANCE_THRESHOLD: float = 0.55 # Max normalized centroid Euclidean distance to match target
    CENTER_DEADBAND: float = 0.08          # Normalized threshold around center considered 'CENTERED'
    VELOCITY_HISTORY_FRAMES: int = 5       # Window size of recent positions for linear velocity estimation
    VELOCITY_DAMPING: float = 0.88         # Velocity decay multiplier during occlusion grace frames
    
    # External Live Feed Publishing settings (for Admin/Vet Live Feed Viewer)
    PUBLISH_TARGET_URL: str = ""           # Configurable external WebSocket endpoint, e.g. ws://dashboard:8000/ws/live-feed
    PUBLISH_FEED_ENABLED: bool = True      # Dispatch live feed to external target when configured
    
    # Phase 2 Hardware / Servo settings (0-180 degrees)
    SERVO_PAN_DEFAULT: float = 90.0
    SERVO_TILT_DEFAULT: float = 90.0
    SERVO_PAN_MIN: float = 0.0
    SERVO_PAN_MAX: float = 180.0
    SERVO_TILT_MIN: float = 15.0
    SERVO_TILT_MAX: float = 165.0
    SERVO_P_GAIN: float = 4.0              # Proportional gain for servo angle adjustments
    
    # SentryWing 8-class species list (matching notebook training order)
    ANIMAL_CLASSES: list[str] = [
        "tiger",      # 0
        "cheetah",    # 1
        "lion",       # 2
        "hyena",      # 3
        "leopard",    # 4
        "bear",       # 5
        "fox",        # 6
        "elephant",   # 7
    ]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


config = Settings()
