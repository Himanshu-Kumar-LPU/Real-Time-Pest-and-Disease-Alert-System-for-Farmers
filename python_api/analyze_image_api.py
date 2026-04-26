#!/usr/bin/env python3
"""Multi-input agricultural disease analyzer.

Usage: python analyze_image_api.py <image_path>
Output JSON schema:
{
  "type": "leaf|fruit|plant",
  "disease": "...",
  "confidence": 0.0-1.0,
  "suggestion": "..."
}
"""

import argparse
import json
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ModuleNotFoundError as exc:
    print(json.dumps({"error": f"Missing Python module: {exc.name}. Install dependencies first."}))
    sys.exit(1)
except Exception as exc:
    print(json.dumps({"error": str(exc)}))
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
LOW_CONFIDENCE_THRESHOLD = 0.5


MODEL_CUSTOM_OBJECTS = None


def _get_keras_model_loader():
    import tensorflow as tf  # noqa: F401
    import keras

    class LegacyCompatibleInputLayer(keras.layers.InputLayer):
        def __init__(self, *args, batch_shape=None, optional=None, **kwargs):
            if batch_shape is not None and "shape" not in kwargs:
                if isinstance(batch_shape, (list, tuple)) and len(batch_shape) > 1:
                    kwargs["shape"] = tuple(batch_shape[1:])
            kwargs.pop("optional", None)
            super().__init__(*args, **kwargs)

    keras.layers.InputLayer = LegacyCompatibleInputLayer
    try:
        import keras.src.layers.core.input_layer as keras_input_layer_module
        keras_input_layer_module.InputLayer = LegacyCompatibleInputLayer
    except Exception:
        pass

    return keras, {"InputLayer": LegacyCompatibleInputLayer}

MODEL_REGISTRY = {
    "leaf": {
        "model_name": "leaf_model (trained on Dataset folder)",
        "class_names": [SCRIPT_DIR / "class_names.json"],
        "model_candidates": [
            SCRIPT_DIR / "models" / "leaf_model.keras",
            SCRIPT_DIR / "models" / "leaf_model.h5",
            SCRIPT_DIR.parent / "Plant_Disease_Prediction" / "trained_model.keras",
        ],
    },
    "fruit": {
        "model_name": "fruit_model",
        "class_names": [SCRIPT_DIR / "models" / "fruit_class_names.json"],
        "model_candidates": [
            SCRIPT_DIR / "models" / "fruit_model.keras",
            SCRIPT_DIR / "models" / "fruit_model.h5",
        ],
    },
    "plant": {
        "model_name": "plant_model",
        "class_names": [SCRIPT_DIR / "models" / "plant_class_names.json"],
        "model_candidates": [
            SCRIPT_DIR / "models" / "plant_model.keras",
            SCRIPT_DIR / "models" / "plant_model.h5",
        ],
    },
}

DEFAULT_SUGGESTION = "Monitor the crop for 2-3 days and consult a local agriculture expert for confirmation."
DISEASE_SUGGESTIONS = {
    "Tomato___Late_blight": "ACTION NEEDED (Check daily): 1. REMOVE all infected leaves and fruits TODAY 2. Spray the remaining plant with Bordeaux mixture (1%) or copper fungicide 3. STOP using water from above - water only at the base 4. Spray again after 7-10 days 5. Remove infected plants if more than 30% is affected. Why? This disease spreads FAST in wet weather. Act immediately!",
    
    "Potato___Early_blight": "START TREATMENT NOW: 1. Cut and remove all spotted leaves (burn or bury them) 2. Spray entire plant with fungicide (Mancozeb or Captan) 3. Make sure air flows between plants - remove extra leaves from bottom 4. Repeat spray every 10 days until flowering stops 5. Do NOT touch wet plants - disease spreads easily. Tip: Remove lowest leaves to improve airflow",
    
    "Tomato___Bacterial_spot": "URGENT - Act Today: 1. Remove ALL spotted leaves and fruits (throw away or burn) 2. Do NOT use water sprinklers - water only at roots 3. Spray with copper fungicide or Bordeaux mixture 4. Wash your hands and tools with soap before touching other plants 5. Spray again after 7-10 days. Warning: Spreads through water and touch!",
    
    "Apple___Black_rot": "REMOVE INFECTED PARTS: 1. Cut off all infected branches (cut 30cm below the dark spot) 2. Burn or bury the cut branches immediately 3. Spray the whole tree with copper sulfate or fungicide 4. Do this in early morning or late evening 5. Repeat spray every 14 days during wet season. Best time: Spray when weather is dry for 24 hours",
    
    "Potato___Late_blight": "CRITICAL - Act IMMEDIATELY: 1. Remove ALL diseased leaves and plants 2. Do NOT harvest yet - disease will spread to potatoes 3. Spray surrounding plants with fungicide NOW 4. Stop overhead watering TODAY 5. Spray every 7-10 days for 4 weeks. If more than 25% plant is infected - REMOVE THE WHOLE PLANT",
    
    "Apple___Cedar_apple_rust": "NEEDS ATTENTION: 1. Remove all infected fruits and leaves (cut and destroy) 2. Spray with sulfur dust or copper fungicide 3. Repeat spray every 2 weeks until fruit harvest 4. Remove any cedar/juniper plants nearby (they help disease spread) 5. Clean fallen leaves and fruits. Better prevention than cure!",
    
    "Apple___Apple_scab": "PREVENT SPREAD: 1. Remove all infected leaves and fruits 2. Clean all fallen leaves from ground (bury or burn) 3. Spray with sulfur dust in early morning 4. Improve air circulation - prune extra branches 5. Repeat spray every 10-14 days. Clean field = Healthy plant",
    
    "Tomato___Tomato_mosaic_virus": "NO SPRAY WORKS - REMOVE PLANT: 1. Remove the entire infected plant immediately 2. Burn or bury it (do NOT compost) 3. Wash your hands and tools with hot soapy water 4. Do NOT touch other plants for 30 minutes 5. Choose virus-resistant seeds for next season. Viruses cannot be killed - only removed!",
    
    "Tomato___Early_blight": "START IMMEDIATELY: 1. Remove all brown/spotted lower leaves (up to first flower branch) 2. Spray with Mancozeb, Chlorothalonil, or copper fungicide 3. Water ONLY at roots - never from above 4. Space plants further apart for better air 5. Spray again after 7-10 days. Caught early? Easy to control!",
    
    "Potato___Healthy": "GOOD NEWS - Keep it healthy: 1. Continue checking leaves every 3-4 days 2. Remove any yellowing or spotted leaves immediately 3. Water at the base, not from above 4. Apply fertilizer as per schedule 5. Stay alert - healthy plants can get sick quickly. Keep watching!",
    
    "Tomato___Healthy": "PLANT IS HEALTHY - Maintain care: 1. Check for signs of disease every 2-3 days 2. Remove old/lower leaves to improve airflow 3. Water early morning only 4. Give fertilizer as planned 5. Remove any weeds nearby. Prevention is easier than treatment!",
    
    "Apple___Healthy": "APPLE TREE IS HEALTHY: 1. Monitor leaves and fruits every week 2. Remove fallen leaves and fruits immediately 3. Prune dead or crowded branches 4. Water during dry season 5. Remove nearby diseased plants. Healthy tree = Good harvest!",
    
    "healthy": "PLANT LOOKS HEALTHY - Keep it that way: 1. Check every 3-4 days for any spots or yellowing 2. Water properly (not too wet, not too dry) 3. Remove dead leaves and weeds 4. Give nutrients on time 5. Keep the field clean. Better to prevent than to cure!",
}


def _load_json_list(candidates):
    for file_path in candidates:
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
    return []


def _sanitize_keras_config(node):
    changed = False

    if isinstance(node, dict):
        if "quantization_config" in node:
            node.pop("quantization_config", None)
            changed = True

        if "dtype" in node and isinstance(node["dtype"], dict):
            dtype_obj = node["dtype"]
            if dtype_obj.get("class_name") == "DTypePolicy":
                node["dtype"] = dtype_obj.get("config", {}).get("name", "float32")
                changed = True

        class_name = node.get("class_name")
        config = node.get("config")
        if class_name == "InputLayer" and isinstance(config, dict):
            if "batch_shape" in config and "batch_input_shape" not in config:
                config["batch_input_shape"] = config.pop("batch_shape")
                changed = True
            if "optional" in config:
                config.pop("optional", None)
                changed = True

        for value in node.values():
            if _sanitize_keras_config(value):
                changed = True

    elif isinstance(node, list):
        for item in node:
            if _sanitize_keras_config(item):
                changed = True

    return changed


def _build_sanitized_keras_archive(model_path: Path):
    if not zipfile.is_zipfile(model_path):
        raise ValueError("Model file is not a valid .keras archive.")

    temp_dir = tempfile.mkdtemp(prefix="keras_sanitize_")
    extracted_dir = Path(temp_dir) / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(model_path, "r") as src_zip:
        src_zip.extractall(extracted_dir)

    config_path = extracted_dir / "config.json"
    if not config_path.exists():
        raise FileNotFoundError("config.json not found inside .keras archive.")

    with open(config_path, "r", encoding="utf-8") as f:
        config_data = json.load(f)

    if not _sanitize_keras_config(config_data):
        raise ValueError("No legacy config fields found to sanitize.")

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config_data, f)

    sanitized_path = Path(temp_dir) / "sanitized_model.keras"
    with zipfile.ZipFile(sanitized_path, "w", zipfile.ZIP_DEFLATED) as dst_zip:
        for file_path in extracted_dir.rglob("*"):
            if file_path.is_file():
                dst_zip.write(file_path, file_path.relative_to(extracted_dir))

    return sanitized_path


def _load_model_from_keras_archive(model_path: Path):
    keras, custom_objects = _get_keras_model_loader()
    try:
        return keras.models.load_model(model_path, compile=False, custom_objects=custom_objects)
    except Exception:
        sanitized_path = _build_sanitized_keras_archive(model_path)
        return keras.models.load_model(sanitized_path, compile=False, custom_objects=custom_objects)


def _load_model(model_path: Path):
    keras, custom_objects = _get_keras_model_loader()
    if str(model_path).lower().endswith(".keras"):
        return _load_model_from_keras_archive(model_path)
    return keras.models.load_model(model_path, compile=False, custom_objects=custom_objects)


def _resolve_image_size(model):
    shape = getattr(model, "input_shape", None)
    if isinstance(shape, tuple) and len(shape) >= 3:
        h, w = shape[1], shape[2]
        if isinstance(h, int) and isinstance(w, int) and h > 0 and w > 0:
            return (w, h)
    return (224, 224)


def detect_image_type(image: Image.Image) -> str:
    """Heuristic classifier for leaf/fruit/plant that rejects obvious non-plant photos."""
    arr = np.asarray(image.convert("RGB").resize((256, 256), Image.LANCZOS), dtype=np.float32) / 255.0
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]

    green_ratio = float(np.mean((g > r * 1.08) & (g > b * 1.08) & (g > 0.16)))
    fruit_color_ratio = float(np.mean((r > 0.45) & (g > 0.18) & (b < 0.45)))
    dark_ratio = float(np.mean((r + g + b) / 3.0 < 0.22))
    skin_like_ratio = float(
        np.mean(
            (r > 0.35)
            & (g > 0.20)
            & (b > 0.12)
            & (r > g)
            & (g > b)
            & ((r - g) > 0.03)
            & ((r - b) > 0.06)
        )
    )

    # Portrait check: if skin-like pixels dominate center area,
    # reject even when green background exists.
    h, w = r.shape
    y0, y1 = int(h * 0.25), int(h * 0.75)
    x0, x1 = int(w * 0.25), int(w * 0.75)
    center_r = r[y0:y1, x0:x1]
    center_g = g[y0:y1, x0:x1]
    center_b = b[y0:y1, x0:x1]
    center_skin_ratio = float(
        np.mean(
            (center_r > 0.35)
            & (center_g > 0.20)
            & (center_b > 0.12)
            & (center_r > center_g)
            & (center_g > center_b)
            & ((center_r - center_g) > 0.03)
            & ((center_r - center_b) > 0.06)
        )
    )

    # Reject clear non-plant portraits/objects with little vegetation/fruit color.
    if (green_ratio < 0.10 and fruit_color_ratio < 0.08) or (skin_like_ratio > 0.16 and green_ratio < 0.22):
        return "non_plant"

    # Reject likely human portraits with face/skin concentrated in the center.
    if center_skin_ratio > 0.22 and green_ratio < 0.55:
        return "non_plant"

    if green_ratio >= 0.42 and fruit_color_ratio < 0.2:
        return "leaf"
    if fruit_color_ratio >= 0.2 and green_ratio < 0.5:
        return "fruit"
    if dark_ratio > 0.32 and green_ratio < 0.35:
        return "plant"
    return "plant"


def _model_expects_normalized_input(model) -> bool:
    for layer in getattr(model, "layers", []):
        if layer.__class__.__name__ == "Rescaling":
            return False
        break
    return True


def _preprocess_image_for_model(image: Image.Image, image_size, model):
    resized = image.convert("RGB").resize(image_size, Image.LANCZOS)
    image_array = np.asarray(resized, dtype=np.float32)
    if _model_expects_normalized_input(model):
        image_array = image_array / 255.0
    return np.expand_dims(image_array, axis=0)


def _get_disease_suggestion(disease_name: str, confidence: float):
    normalized = str(disease_name or "").strip()
    for key, value in DISEASE_SUGGESTIONS.items():
        if key.lower() in normalized.lower():
            if confidence < LOW_CONFIDENCE_THRESHOLD:
                return "Low confidence. Please upload a clearer image."
            return value
    if confidence < LOW_CONFIDENCE_THRESHOLD:
        return "Low confidence. Please upload a clearer image."
    return DEFAULT_SUGGESTION


def _load_type_model(image_type: str):
    if image_type not in MODEL_REGISTRY:
        return None, [], None, f"Invalid image type: {image_type}", None

    entry = MODEL_REGISTRY[image_type]
    model_name = entry["model_name"]
    classes = _load_json_list(entry["class_names"])

    last_error = None
    for candidate in entry["model_candidates"]:
        if not candidate.exists():
            continue
        try:
            model = _load_model(candidate)
            return model, classes, model_name, None, str(candidate)
        except Exception as exc:
            last_error = f"{candidate.name}: {exc}"

    return None, classes, model_name, last_error, None


def _missing_model_response(image_type: str, model_name: str, model_error: str):
    suggestions = {
        "fruit": {
            "message": "Fruit disease detection not available yet",
            "suggestion": "Please upload a leaf image or add fruit_model files in python_api/models.",
        },
        "plant": {
            "message": "Whole-plant disease detection not available yet",
            "suggestion": "Please upload a leaf image or add plant_model files in python_api/models.",
        },
        "leaf": {
            "message": "Leaf disease detection model is not available",
            "suggestion": "Add leaf_model files in python_api/models and try again.",
        },
    }
    fallback = suggestions.get(image_type, {
        "message": "Invalid image type",
        "suggestion": "Upload a valid leaf, fruit, or whole-plant image.",
    })
    return {
        "type": image_type,
        "model_used": model_name,
        "confidence": 0.0,
        "message": fallback["message"],
        "suggestion": fallback["suggestion"],
        "low_confidence": True,
        "top_predictions": [],
        "meta": {
            "error": model_error,
            "model_path": None,
        },
    }


def analyze_image(image_path: Path):
    image = Image.open(image_path).convert("RGB")
    image_type = detect_image_type(image)
    if image_type == "non_plant":
        return {
            "error": "Uploaded image does not look like a crop/leaf photo.",
            "suggestion": "Upload a close, clear image of a plant leaf or fruit.",
        }
    if image_type not in MODEL_REGISTRY:
        return {
            "error": "Invalid image type",
            "suggestion": "Upload a valid leaf, fruit, or whole-plant image.",
        }

    model, class_names, model_name, model_error, model_source = _load_type_model(image_type)
    # If the heuristic picks a type without an available model, fall back to leaf model.
    if model is None and image_type != "leaf":
        leaf_model, leaf_classes, leaf_model_name, leaf_model_error, leaf_model_source = _load_type_model("leaf")
        if leaf_model is not None:
            model = leaf_model
            class_names = leaf_classes
            model_name = leaf_model_name
            model_source = leaf_model_source
            image_type = "leaf"
            model_error = None

    if model is None:
        return _missing_model_response(image_type, model_name, model_error)

    image_size = _resolve_image_size(model)
    model_input = _preprocess_image_for_model(image, image_size, model)
    raw_preds = np.squeeze(model.predict(model_input, verbose=0))

    if np.isscalar(raw_preds):
        raw_preds = np.array([float(raw_preds)], dtype=np.float32)

    raw_preds = np.asarray(raw_preds, dtype=np.float32)
    if raw_preds.size == 0:
        return {
            "type": image_type,
            "model_used": model_name,
            "confidence": 0.0,
            "message": "Low confidence. Unable to detect disease.",
            "suggestion": "Upload a clearer image with proper focus",
            "low_confidence": True,
            "top_predictions": [],
        }

    pred_sum = float(np.sum(raw_preds))
    if pred_sum > 0:
        predictions = raw_preds / pred_sum
    else:
        predictions = raw_preds

    sorted_indices = np.argsort(predictions)[::-1]
    top_index = int(sorted_indices[0])
    confidence = float(np.clip(predictions[top_index], 0.0, 1.0))
    disease = class_names[top_index] if top_index < len(class_names) else f"class_{top_index}"

    top_predictions = []
    for idx in sorted_indices[:3]:
        label = class_names[int(idx)] if int(idx) < len(class_names) else f"class_{int(idx)}"
        top_predictions.append(
            {
                "name": label,
                "confidence": float(np.clip(predictions[int(idx)], 0.0, 1.0)),
            }
        )

    if confidence < LOW_CONFIDENCE_THRESHOLD:
        return {
            "type": image_type,
            "model_used": model_name,
            "confidence": confidence,
            "message": "Low confidence. Unable to detect disease.",
            "suggestion": "Upload a clearer image with proper focus",
            "low_confidence": True,
            "top_predictions": top_predictions,
            "meta": {
                "model_path": model_source,
                "input_size": list(image_size),
            },
        }

    return {
        "type": image_type,
        "model_used": model_name,
        "disease": disease,
        "confidence": confidence,
        "suggestion": _get_disease_suggestion(disease, confidence),
        "low_confidence": False,
        "top_predictions": top_predictions,
        "meta": {
            "model_path": model_source,
            "input_size": list(image_size),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze plant image")
    parser.add_argument("image_path", help="Path to image file")
    parser.add_argument("--detect-only", action="store_true", help="Only detect image type")
    args = parser.parse_args()

    image_path = Path(args.image_path)
    if not image_path.exists():
        print(json.dumps({"error": f"Image file not found: {image_path}"}))
        sys.exit(1)

    try:
        if args.detect_only:
            image = Image.open(image_path).convert("RGB")
            detected_type = detect_image_type(image)
            print(json.dumps({"type": detected_type}))
            return

        result = analyze_image(image_path)
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
