"""
SentryWing Dosage Module — Stage 3 Tranquilizer Dart Dosage Calculator.

Consumes:
  - Stage 1: Species identification (tiger, cheetah, lion, hyena, leopard, bear, fox, elephant)
  - Stage 2: Bio-attributes (age category, age range, body size, weight range, health/vitality condition)
  - Optional: Numeric weight estimate (kg)

Outputs:
  - drug_recommendation: Recommended pharmaceutical compound / cocktail
  - dosage_mg: Total recommended drug mass in milligrams
  - dosage_per_kg: Milligrams per kilogram of body weight (mg/kg)
  - confidence: Estimation confidence score (0.0 – 1.0)
  - notes: Clinical remarks, reversal agents (e.g. Atipamezole, Naloxone), and protocol guidance
  - disclaimer: "AI-estimated dosage — verify before administering"

Supports plug-and-play drop-in weights:
  Checks models/dosage_model.onnx and models/dosage_model.pt.
  If weights are present, executes neural inference; otherwise uses calibrated
  veterinary immobilization formulary tables.
"""

import re
import logging
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any, List, Tuple

from config import config

logger = logging.getLogger("dosage")
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class DosageResult:
    """Stage 3 Recommended Dart Dosage Result."""
    drug_recommendation: str
    dosage_mg: float
    dosage_per_kg: float
    confidence: float
    notes: str
    estimated_weight_kg: Optional[float] = None
    disclaimer: str = "AI-estimated dosage — verify before administering"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Calibrated Veterinary Immobilization Formulary (Zoo & Wildlife Medicine)
# References: Fowler's Zoo and Wild Animal Medicine; AAZV Guidelines; Kreeger Handbook
# ---------------------------------------------------------------------------

VET_FORMULARY: Dict[str, Dict[str, Any]] = {
    "tiger": {
        "primary_drug": "Ketamine (100 mg/ml) + Medetomidine (1 mg/ml)",
        "base_mg_per_kg": 3.50,          # Ketamine component baseline
        "adjunct_mg_per_kg": 0.07,       # Medetomidine component baseline
        "typical_weight_kg": {
            "juvenile": 45.0,
            "subadult": 95.0,
            "adult": 160.0,
            "mature": 150.0,
        },
        "reversal_agent": "Atipamezole (5 mg/ml) at 5x Medetomidine dose (IM)",
        "notes_template": "Induction: 5-8 min. Reversal: Atipamezole IM at 5x Medetomidine dose. Monitor hypothermia and corneal lubrication."
    },
    "lion": {
        "primary_drug": "Ketamine (100 mg/ml) + Medetomidine (1 mg/ml)",
        "base_mg_per_kg": 3.80,
        "adjunct_mg_per_kg": 0.08,
        "typical_weight_kg": {
            "juvenile": 50.0,
            "subadult": 110.0,
            "adult": 175.0,
            "mature": 165.0,
        },
        "reversal_agent": "Atipamezole (5 mg/ml) at 5x Medetomidine dose (IM)",
        "notes_template": "Induction: 6-10 min. Administer Atipamezole for reversal. Ensure blindfold and earplugs to reduce acoustic arousal."
    },
    "leopard": {
        "primary_drug": "Ketamine (100 mg/ml) + Medetomidine (1 mg/ml)",
        "base_mg_per_kg": 4.00,
        "adjunct_mg_per_kg": 0.06,
        "typical_weight_kg": {
            "juvenile": 20.0,
            "subadult": 38.0,
            "adult": 55.0,
            "mature": 50.0,
        },
        "reversal_agent": "Atipamezole at 5x Medetomidine dose",
        "notes_template": "Induction: 4-7 min. High safety margin with Medetomidine combination. Reversible with Atipamezole."
    },
    "cheetah": {
        "primary_drug": "Ketamine (100 mg/ml) + Midazolam (5 mg/ml)",
        "base_mg_per_kg": 3.00,
        "adjunct_mg_per_kg": 0.15,
        "typical_weight_kg": {
            "juvenile": 18.0,
            "subadult": 30.0,
            "adult": 45.0,
            "mature": 40.0,
        },
        "reversal_agent": "Flumazenil (0.05 mg/kg for Midazolam reversal)",
        "notes_template": "Cheetahs are prone to hyperthermia and stress-induced cardiomyopathy. Keep dart volume low; prepare Flumazenil reversal."
    },
    "hyena": {
        "primary_drug": "Telazol (Tiletamine-Zolazepam 100 mg/ml) + Xylazine (100 mg/ml)",
        "base_mg_per_kg": 3.20,
        "adjunct_mg_per_kg": 0.80,
        "typical_weight_kg": {
            "juvenile": 25.0,
            "subadult": 42.0,
            "adult": 62.0,
            "mature": 58.0,
        },
        "reversal_agent": "Yohimbine (0.15 mg/kg) or Atipamezole (0.1 mg/kg)",
        "notes_template": "Strong jaw tone remains. Induction: 4-6 min. Yohimbine reverses Xylazine sedation; Telazol wears off metabolically."
    },
    "bear": {
        "primary_drug": "Telazol (100 mg/ml) + Medetomidine (1 mg/ml)",
        "base_mg_per_kg": 4.00,
        "adjunct_mg_per_kg": 0.04,
        "typical_weight_kg": {
            "juvenile": 40.0,
            "subadult": 110.0,
            "adult": 220.0,
            "mature": 200.0,
        },
        "reversal_agent": "Atipamezole (5 mg/ml) at 5x Medetomidine dose",
        "notes_template": "Induction: 7-12 min. Thick sub-cutis fat layer requires deep 2.5-3.0 inch dart needle. Reversible with Atipamezole."
    },
    "fox": {
        "primary_drug": "Ketamine (100 mg/ml) + Xylazine (20 mg/ml)",
        "base_mg_per_kg": 5.00,
        "adjunct_mg_per_kg": 1.20,
        "typical_weight_kg": {
            "juvenile": 3.0,
            "subadult": 5.5,
            "adult": 8.5,
            "mature": 8.0,
        },
        "reversal_agent": "Atipamezole (0.2 mg/kg) or Yohimbine (0.15 mg/kg)",
        "notes_template": "High metabolic rate requires careful dosage. Protect from hypothermia during recovery. Use 1.0ml micro-dart."
    },
    "elephant": {
        "primary_drug": "Etorphine HCl (M99, 9.8 mg/ml) + Azaperone (100 mg/ml)",
        "base_mg_per_kg": 0.0035,        # Ultra-potent opioid: ~3.5 mcg/kg
        "adjunct_mg_per_kg": 0.035,
        "typical_weight_kg": {
            "juvenile": 800.0,
            "subadult": 1800.0,
            "adult": 3500.0,
            "mature": 4200.0,
        },
        "reversal_agent": "Naltrexone HCl (50 mg/ml) or Diprenorphine (M5050) at 2x Etorphine dose IV",
        "notes_template": "CRITICAL: Schedule II ultra-potent opioid. Human antagonist (Naloxone) must be on standby. Keep trunk airway clear."
    },
    "animal": {
        "primary_drug": "Ketamine (100 mg/ml) + Medetomidine (1 mg/ml)",
        "base_mg_per_kg": 4.00,
        "adjunct_mg_per_kg": 0.06,
        "typical_weight_kg": {
            "juvenile": 30.0,
            "subadult": 60.0,
            "adult": 100.0,
            "mature": 90.0,
        },
        "reversal_agent": "Atipamezole at 5x Medetomidine dose",
        "notes_template": "General wildlife protocol. Adjust for species upon confirmation. Monitor heart rate and SpO2 continuously."
    }
}

# Age category adjustments
AGE_FACTOR: Dict[str, float] = {
    "juvenile": 0.70,   # Lower liver metabolism & higher sensitivity
    "subadult": 0.88,   # Developing lean mass
    "adult": 1.00,      # Baseline reference
    "mature": 0.92,     # Senior organ clearance caution
    "unknown": 0.95
}


def _extract_weight_from_string(weight_str: Optional[str]) -> Optional[float]:
    """
    Parses numeric weight estimate from strings like:
    '160–250 kg', '40-90 kg', '3500 kg', 'approx 55kg'
    """
    if not weight_str or not isinstance(weight_str, str):
        return None

    # Look for range like "160–250 kg" or "160-250"
    match_range = re.findall(r"(\d+(?:\.\d+)?)\s*[–\-—to]\s*(\d+(?:\.\d+)?)", weight_str)
    if match_range:
        try:
            low = float(match_range[0][0])
            high = float(match_range[0][1])
            return round((low + high) / 2.0, 1)
        except (ValueError, IndexError):
            pass

    # Look for single number
    match_single = re.findall(r"(\d+(?:\.\d+)?)", weight_str)
    if match_single:
        try:
            return round(float(match_single[0]), 1)
        except ValueError:
            pass

    return None


def _categorize_age(age_input: Any) -> str:
    """Normalizes age string/dict to standard band ('juvenile', 'subadult', 'adult', 'mature')."""
    if isinstance(age_input, dict):
        val = age_input.get("value") or age_input.get("category") or ""
    elif isinstance(age_input, str):
        val = age_input
    else:
        val = str(age_input or "")

    val_lower = val.lower()
    if "juvenile" in val_lower or "infant" in val_lower or "cub" in val_lower or "calf" in val_lower:
        return "juvenile"
    elif "subadult" in val_lower or "young" in val_lower or "adolescent" in val_lower:
        return "subadult"
    elif "mature" in val_lower or "elderly" in val_lower or "senior" in val_lower:
        return "mature"
    elif "adult" in val_lower:
        return "adult"
    return "adult"


# ---------------------------------------------------------------------------
# Dosage Inference Engine
# ---------------------------------------------------------------------------

class DosageEngine:
    """
    Stage 3 Dart Dosage Recommendation Engine.
    Employs the same swap-in pattern as the Stage 1 detector:
      1. Auto-discovers weights at models/dosage_model.onnx or models/dosage_model.pt
      2. If trained weights are found, executes ML model inference.
      3. Otherwise, falls back to the calibrated veterinary clinical rule engine.
    """
    def __init__(self):
        self.model_type: str = "stub_engine"
        self.model_instance: Any = None
        self.model_path: str = ""
        self.load_dosage_model()

    @property
    def is_loaded(self) -> bool:
        return self.model_instance is not None

    def load_dosage_model(self) -> str:
        """
        Attempts to load trained weights from models/dart_dose_model.joblib,
        dosage_model.onnx, dosage_model.pt, or any dosage weights in models/.
        """
        search_paths: List[Path] = [
            getattr(config, "DOSAGE_JOBLIB_PATH", config.MODELS_DIR / "dart_dose_model.joblib"),
            config.MODELS_DIR / "dart_dose_model.joblib",
            config.MODELS_DIR / "dart_dose_model.pkl",
            config.MODELS_DIR / "dosage_model.joblib",
            config.MODELS_DIR / "dosage_model.onnx",
            config.MODELS_DIR / "dosage_model.pt",
            config.MODELS_DIR / "dosage.onnx",
            config.MODELS_DIR / "dosage.pt",
        ]

        # Scan models directory if it exists
        if config.MODELS_DIR.exists():
            for p in config.MODELS_DIR.glob("*dart*.joblib"):
                if p not in search_paths:
                    search_paths.append(p)
            for p in config.MODELS_DIR.glob("*dart*.pkl"):
                if p not in search_paths:
                    search_paths.append(p)
            for p in config.MODELS_DIR.glob("*dosage*.joblib"):
                if p not in search_paths:
                    search_paths.append(p)
            for p in config.MODELS_DIR.glob("*dosage*.onnx"):
                if p not in search_paths:
                    search_paths.append(p)
            for p in config.MODELS_DIR.glob("*dosage*.pt"):
                if p not in search_paths:
                    search_paths.append(p)

        for p in search_paths:
            if p.exists():
                # Attempt Joblib / Scikit-learn load
                if p.suffix.lower() in (".joblib", ".pkl"):
                    try:
                        import warnings
                        import sklearn.compose._column_transformer as ct
                        if not hasattr(ct, '_RemainderColsList'):
                            class _RemainderColsList(list):
                                pass
                            ct._RemainderColsList = _RemainderColsList

                        import joblib
                        with warnings.catch_warnings():
                            warnings.simplefilter("ignore")
                            self.model_instance = joblib.load(str(p))
                        self.model_type = "dart_dose_model"
                        self.model_path = str(p)
                        logger.info(f"Loaded trained Stage 3 Dart Dosage model from: {p}")
                        return self.model_type
                    except Exception as e:
                        logger.warning(f"Failed to load joblib model {p}: {e}")

                # Attempt ONNX runtime load
                elif p.suffix.lower() == ".onnx":
                    try:
                        import onnxruntime as ort
                        self.model_instance = ort.InferenceSession(str(p))
                        self.model_type = "dosage_onnx"
                        self.model_path = str(p)
                        logger.info(f"Loaded trained Stage 3 Dosage ONNX model from: {p}")
                        return self.model_type
                    except Exception as e:
                        logger.warning(f"Failed to load ONNX model {p}: {e}")

                # Attempt PyTorch load
                elif p.suffix.lower() == ".pt":
                    try:
                        import torch
                        self.model_instance = torch.jit.load(str(p)) if "jit" in str(p) else torch.load(str(p), map_location="cpu")
                        self.model_type = "dosage_pt"
                        self.model_path = str(p)
                        logger.info(f"Loaded trained Stage 3 Dosage PyTorch model from: {p}")
                        return self.model_type
                    except Exception as e:
                        logger.warning(f"Failed to load PyTorch model {p}: {e}")

        self.model_type = "stub_engine"
        self.model_instance = None
        self.model_path = ""
        logger.info("Stage 3 Dosage model weights not found in models/; using calibrated veterinary formulary stub.")
        return self.model_type

    def _run_dart_dose_model(
        self,
        clean_species: str,
        age_band: str,
        attrs: Dict[str, Any],
        parsed_weight: float,
        formulary: Dict[str, Any]
    ) -> Optional[DosageResult]:
        """
        Executes inference using the trained dart_dose_model.joblib pipeline.
        Features expected by pipeline:
          ['Species_Common_Name', 'Forest_Region', 'Demographic_Class',
           'Health_Status_BCS', 'Stress_Excitement_Level', 'Immobilizing_Regimen',
           'Estimated_Weight_kg', 'Drug_Concentration_mg_ml']
        """
        try:
            import pandas as pd
            import numpy as np

            SPECIES_MAP = {
                "tiger": "Bengal Tiger",
                "leopard": "Indian Leopard",
                "elephant": "Asian Elephant",
                "bear": "Sloth Bear",
                "deer": "Chital (Spotted Deer)",
                "chital": "Chital (Spotted Deer)",
                "sambar": "Sambar Deer",
                "gaur": "Indian Gaur",
                "rhino": "Indian Rhinoceros",
            }
            species_name = SPECIES_MAP.get(clean_species, clean_species.title())

            # Demographic class
            sex_str = str(attrs.get("sex") or "").lower()
            if "juv" in age_band or "calf" in age_band or "fawn" in age_band:
                demographic = "Fawn/Juvenile" if clean_species in ("deer", "chital", "sambar") else "Calf/Juvenile"
            elif "subadult" in age_band or "sub-adult" in age_band:
                demographic = "Sub-Adult"
            elif "female" in sex_str:
                demographic = "Adult Cow" if clean_species in ("elephant", "gaur", "rhino") else "Adult Female"
            else:
                if clean_species in ("elephant", "gaur", "rhino"):
                    demographic = "Adult Bull"
                elif clean_species in ("deer", "chital", "sambar"):
                    demographic = "Adult Stag"
                else:
                    demographic = "Adult Male"

            # Health BCS
            vitality_str = str(attrs.get("vitality_status") or attrs.get("condition") or "").lower()
            if any(w in vitality_str for w in ("injur", "wound", "snare", "bleed", "lacerat")):
                health_bcs = "Injured / Snare Wound / Dehydrated"
            elif any(w in vitality_str for w in ("emaciat", "weak", "thin", "under")):
                health_bcs = "Underconditioned / Emaciated (BCS 1-2/5)"
            elif any(w in vitality_str for w in ("obese", "over", "heavy")):
                health_bcs = "Overconditioned / Obese (BCS 4-5/5)"
            elif any(w in vitality_str for w in ("geriatric", "old", "dentition")):
                health_bcs = "Geriatric / Worn dentition"
            else:
                health_bcs = "Healthy / Optimal BCS (3/5)"

            # Stress excitement level
            posture_str = str(attrs.get("behavior_posture") or attrs.get("posture") or attrs.get("behaviour") or "").lower()
            if any(w in posture_str for w in ("aggress", "charg", "shock", "defens")):
                stress_lvl = "Aggressive defensive / In shock"
            elif any(w in posture_str for w in ("agitat", "flight", "flee", "conflict", "run")):
                stress_lvl = "Agitated / In conflict / High flight stress"
            elif any(w in posture_str for w in ("letharg", "down")):
                stress_lvl = "Lethargic / Weak"
            elif any(w in posture_str for w in ("rest", "sleep", "calm", "lying")):
                stress_lvl = "Calm / Resting"
            else:
                stress_lvl = "Moderate alert"

            # Immobilizing regimen
            if clean_species in ("elephant", "rhino"):
                regimen = "Xylazine HCl"
                reversal = "Naltrexone / Yohimbine IV"
                conc = 100.0
            elif clean_species in ("gaur", "deer", "chital", "sambar"):
                regimen = "Xylazine + Ketamine"
                reversal = "Atipamezole / Yohimbine IM"
                conc = 100.0
            elif clean_species == "bear":
                regimen = "Tiletamine-Zolazepam (Zoletil 100)"
                reversal = "Supportive therapy & Flumazenil"
                conc = 100.0
            else:
                regimen = "Ketamine (100 mg/ml) + Xylazine (100 mg/ml)"
                reversal = formulary.get("reversal_agent", "Atipamezole (5 mg/ml) IM")
                conc = 100.0

            region = "Central & Northern Forests (Kanha, Corbett, Sundarbans)"
            loc_str = str(attrs.get("location_name") or "").lower()
            if any(w in loc_str for w in ("bandipur", "wayanad", "south", "kerala", "karnataka")):
                region = "Bandipur, Wayanad, Western Ghats"
            elif any(w in loc_str for w in ("kaziranga", "assam", "manas")):
                region = "Kaziranga, Manas, Assam Terai"

            input_df = pd.DataFrame([{
                "Species_Common_Name": species_name,
                "Forest_Region": region,
                "Demographic_Class": demographic,
                "Health_Status_BCS": health_bcs,
                "Stress_Excitement_Level": stress_lvl,
                "Immobilizing_Regimen": regimen,
                "Estimated_Weight_kg": float(parsed_weight),
                "Drug_Concentration_mg_ml": float(conc)
            }])

            pred_dose_per_kg = float(self.model_instance.predict(input_df)[0])
            effective_per_kg = round(max(0.005, pred_dose_per_kg), 4)
            total_mg = round(effective_per_kg * parsed_weight, 1)
            vol_ml = round(total_mg / conc, 2)

            # Ensemble confidence estimation from tree predictions
            try:
                preprocess = self.model_instance.named_steps["preprocess"]
                regressor = self.model_instance.named_steps["regressor"]
                X_t = preprocess.transform(input_df)
                tree_preds = np.array([tree.predict(X_t)[0] for tree in regressor.estimators_])
                mean_val = float(np.mean(tree_preds))
                std_val = float(np.std(tree_preds))
                confidence = round(float(np.clip(1.0 - (std_val / (mean_val + 1e-5)), 0.75, 0.98)), 2)
            except Exception:
                confidence = 0.91

            notes = (
                f"dart_dose_model ML inference for est. {parsed_weight:.1f} kg {demographic} "
                f"({health_bcs}, {stress_lvl}). Dart Volume: {vol_ml} mL ({conc:.0f} mg/mL). Reversal: {reversal}."
            )

            return DosageResult(
                drug_recommendation=regimen,
                dosage_mg=total_mg,
                dosage_per_kg=effective_per_kg,
                confidence=confidence,
                notes=notes,
                estimated_weight_kg=round(float(parsed_weight), 1),
                disclaimer="AI-estimated dosage — verify before administering"
            )
        except Exception as e:
            logger.warning(f"dart_dose_model ML inference failed, falling back to formulary: {e}")
            return None

    def run_dosage(
        self,
        species: str,
        age: Any,
        health_attributes: Optional[Dict[str, Any]] = None,
        weight_estimate: Optional[float] = None
    ) -> DosageResult:
        """
        Computes recommended tranquilizer dart dosage for the given species & biometrics.
        """
        clean_species = (species or "animal").strip().lower()
        formulary = VET_FORMULARY.get(clean_species, VET_FORMULARY["animal"])

        # 1. Determine standardized age category
        age_band = _categorize_age(age)
        age_mult = AGE_FACTOR.get(age_band, 1.0)

        # 2. Determine estimated weight
        if isinstance(health_attributes, str):
            attrs = {"condition": health_attributes, "vitality_status": health_attributes}
        elif isinstance(health_attributes, dict):
            attrs = dict(health_attributes)
        else:
            attrs = {}
        parsed_weight: Optional[float] = None

        if weight_estimate is not None and weight_estimate > 0:
            parsed_weight = float(weight_estimate)
        else:
            # Try to extract from health_attributes
            if "estimated_weight_kg" in attrs and attrs["estimated_weight_kg"]:
                try:
                    parsed_weight = float(attrs["estimated_weight_kg"])
                except (ValueError, TypeError):
                    pass
            if parsed_weight is None and "weight_range" in attrs:
                parsed_weight = _extract_weight_from_string(attrs.get("weight_range"))

        # Fallback to typical species/age weight
        if parsed_weight is None or parsed_weight <= 0:
            typical_weights = formulary.get("typical_weight_kg", {})
            parsed_weight = float(typical_weights.get(age_band, 100.0))

        # If trained dart_dose_model is loaded, execute ML model inference
        if self.model_type == "dart_dose_model" and self.model_instance is not None:
            ml_result = self._run_dart_dose_model(
                clean_species=clean_species,
                age_band=age_band,
                attrs=attrs,
                parsed_weight=parsed_weight,
                formulary=formulary
            )
            if ml_result is not None:
                return ml_result

        # 3. Dosage per kg calculation (veterinary formulary fallback)
        base_per_kg = formulary["base_mg_per_kg"]
        adjunct_per_kg = formulary.get("adjunct_mg_per_kg", 0.0)

        # 4. Check for vitality / health condition adjustments
        vitality_str = str(attrs.get("vitality_status") or attrs.get("condition") or "").lower()
        quality_flags = attrs.get("quality_flags") or []
        health_notes_additions: List[str] = []

        condition_mult = 1.0
        if any(w in vitality_str for w in ("injured", "compromised", "lethargic", "critical", "emaciated")):
            condition_mult = 0.82   # Reduce by 18% for impaired respiration / circulatory shock
            health_notes_additions.append("Condition compromised: dosage scaled down by 18% to mitigate respiratory depression.")

        if any("blur" in str(f).lower() or "dark" in str(f).lower() for f in quality_flags):
            health_notes_additions.append("Image resolution compromised; verify mass visually prior to loading dart.")

        effective_per_kg = round(base_per_kg * age_mult * condition_mult, 4)
        total_mg = round(effective_per_kg * parsed_weight, 1)

        # 5. Model confidence calculation
        # Baseline rule confidence: 0.90; drops slightly if weight was inferred rather than explicitly provided
        confidence = 0.90
        if weight_estimate is None and "estimated_weight_kg" not in attrs:
            confidence -= 0.08
        if "unknown" in age_band:
            confidence -= 0.07
        confidence = round(max(0.60, min(0.96, confidence)), 2)

        # 6. Compose clinical notes
        adjunct_note = ""
        if adjunct_per_kg > 0:
            adjunct_total = round(adjunct_per_kg * parsed_weight * age_mult * condition_mult, 2)
            adjunct_note = f" Co-administer adjunct: {adjunct_total} mg ({adjunct_per_kg} mg/kg)."

        reversal_note = f" Reversal Protocol: {formulary.get('reversal_agent', 'Atipamezole on standby')}."
        base_guidance = formulary.get("notes_template", "Monitor vitals continuously.")

        extra_note_str = (" " + " ".join(health_notes_additions)) if health_notes_additions else ""
        combined_notes = (
            f"Calculated for est. {parsed_weight:.1f} kg {age_band}. "
            f"{base_guidance}{adjunct_note}{reversal_note}{extra_note_str}"
        )

        return DosageResult(
            drug_recommendation=formulary["primary_drug"],
            dosage_mg=total_mg,
            dosage_per_kg=effective_per_kg,
            confidence=confidence,
            notes=combined_notes.strip(),
            estimated_weight_kg=round(float(parsed_weight), 1),
            disclaimer="AI-estimated dosage — verify before administering"
        )


# ---------------------------------------------------------------------------
# Module-level singleton and convenience entry points
# ---------------------------------------------------------------------------

dosage_engine = DosageEngine()


def get_dosage_engine() -> DosageEngine:
    """Returns the singleton DosageEngine instance."""
    return dosage_engine


def load_dosage_model() -> str:
    """Reloads or checks for new dosage model weights."""
    return dosage_engine.load_dosage_model()


def run_dosage(
    species: str,
    age: Any,
    health_attributes: Optional[Dict[str, Any]] = None,
    weight_estimate: Optional[float] = None
) -> DosageResult:
    """Convenience wrapper around dosage_engine.run_dosage."""
    return dosage_engine.run_dosage(
        species=species,
        age=age,
        health_attributes=health_attributes,
        weight_estimate=weight_estimate
    )
