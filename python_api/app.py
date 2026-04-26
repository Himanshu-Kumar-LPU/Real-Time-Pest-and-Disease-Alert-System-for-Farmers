from flask import Flask, request, jsonify
from PIL import Image
import numpy as np
import json
import os
import tempfile
import zipfile
import atexit

app = Flask(__name__)

BASE_DIR = os.path.dirname(__file__)
CLASS_NAMES_PATH = os.path.join(BASE_DIR, "class_names.json")
FRUIT_MODEL_PATH = os.path.join(BASE_DIR, "models", "fruit_model.h5")
FRUIT_CLASS_NAMES_PATH = os.path.join(BASE_DIR, "models", "fruit_class_names.json")
LEAF_MODEL_CANDIDATES = [
    os.path.join(BASE_DIR, "models", "leaf_model.keras"),
    os.path.join(BASE_DIR, "models", "leaf_model.h5"),
    os.path.join(BASE_DIR, "plant_model.h5"),
]
LEAF_MODEL_LOAD_ERROR = None
TENSORFLOW_IMPORT_ERROR = None
TEMP_ARTIFACT_DIRS = []


def _cleanup_temp_artifacts():
    for temp_dir in TEMP_ARTIFACT_DIRS:
        try:
            for root, dirs, files in os.walk(temp_dir, topdown=False):
                for file_name in files:
                    os.remove(os.path.join(root, file_name))
                for dir_name in dirs:
                    os.rmdir(os.path.join(root, dir_name))
            os.rmdir(temp_dir)
        except Exception:
            pass


atexit.register(_cleanup_temp_artifacts)


def _sanitize_input_layer_config(node):
    changed = False

    if isinstance(node, dict):
        class_name = node.get("class_name")
        config = node.get("config")

        if class_name == "InputLayer" and isinstance(config, dict):
            if "batch_shape" in config and "batch_input_shape" not in config:
                config["batch_input_shape"] = config.pop("batch_shape")
                changed = True
            if "optional" in config:
                config.pop("optional", None)
                changed = True

        if isinstance(config, dict) and isinstance(config.get("dtype"), dict):
            dtype_obj = config.get("dtype", {})
            if dtype_obj.get("class_name") == "DTypePolicy":
                dtype_name = dtype_obj.get("config", {}).get("name", "float32")
                config["dtype"] = dtype_name
                changed = True

        if isinstance(config, dict) and "quantization_config" in config:
            config.pop("quantization_config", None)
            changed = True

        for value in node.values():
            if _sanitize_input_layer_config(value):
                changed = True
    elif isinstance(node, list):
        for item in node:
            if _sanitize_input_layer_config(item):
                changed = True

    return changed


def _build_sanitized_keras_archive(model_path):
    if not zipfile.is_zipfile(model_path):
        raise ValueError("Model file is not a valid .keras archive.")

    temp_dir = tempfile.mkdtemp(prefix="keras_legacy_fix_")
    TEMP_ARTIFACT_DIRS.append(temp_dir)
    extracted_dir = os.path.join(temp_dir, "extracted")
    os.makedirs(extracted_dir, exist_ok=True)

    with zipfile.ZipFile(model_path, "r") as src_zip:
        src_zip.extractall(extracted_dir)

    config_path = os.path.join(extracted_dir, "config.json")
    if not os.path.exists(config_path):
        raise FileNotFoundError("config.json not found inside .keras archive.")

    with open(config_path, "r", encoding="utf-8") as config_file:
        config_json = json.load(config_file)

    changed = _sanitize_input_layer_config(config_json)
    if not changed:
        raise ValueError("No legacy InputLayer fields found to sanitize.")

    with open(config_path, "w", encoding="utf-8") as config_file:
        json.dump(config_json, config_file)

    sanitized_path = os.path.join(temp_dir, "sanitized_model.keras")
    with zipfile.ZipFile(sanitized_path, "w", zipfile.ZIP_DEFLATED) as dst_zip:
        for root, _, files in os.walk(extracted_dir):
            for file_name in files:
                abs_file = os.path.join(root, file_name)
                rel_file = os.path.relpath(abs_file, extracted_dir)
                dst_zip.write(abs_file, rel_file)

    return sanitized_path

# Try to load TensorFlow and model
try:
    import tensorflow as tf
    keras = tf.keras
    TENSORFLOW_AVAILABLE = True

    class LegacyCompatibleInputLayer(keras.layers.InputLayer):
        def __init__(self, *args, batch_shape=None, optional=None, **kwargs):
            if batch_shape is not None and "batch_input_shape" not in kwargs:
                if isinstance(batch_shape, (list, tuple)):
                    kwargs["batch_input_shape"] = tuple(batch_shape)
            kwargs.pop("optional", None)
            super().__init__(*args, **kwargs)

    MODEL_CUSTOM_OBJECTS = {
        "InputLayer": LegacyCompatibleInputLayer,
        "keras.layers.InputLayer": LegacyCompatibleInputLayer,
        "tf.keras.layers.InputLayer": LegacyCompatibleInputLayer,
    }
    keras.layers.InputLayer = LegacyCompatibleInputLayer
    try:
        from tensorflow.python.keras.engine import input_layer as tf_input_layer_module
        tf_input_layer_module.InputLayer = LegacyCompatibleInputLayer
    except Exception:
        pass

    model = None
    loaded_leaf_model_path = None
    for candidate in LEAF_MODEL_CANDIDATES:
        if not os.path.exists(candidate):
            continue
        try:
            if candidate.lower().endswith(".keras"):
                try:
                    model = keras.models.load_model(
                        candidate,
                        compile=False,
                    )
                except Exception as direct_error:
                    direct_error_message = str(direct_error)
                    if "batch_shape" in direct_error_message or "optional" in direct_error_message:
                        sanitized_candidate = _build_sanitized_keras_archive(candidate)
                        model = keras.models.load_model(
                            sanitized_candidate,
                            compile=False,
                        )
                        print("Loaded leaf model with legacy InputLayer sanitization.")
                    else:
                        raise
            else:
                model = keras.models.load_model(
                    candidate,
                    compile=False,
                    custom_objects=MODEL_CUSTOM_OBJECTS,
                )
            loaded_leaf_model_path = candidate
            print(f"Loaded leaf model from {candidate}")
            break
        except Exception as e:
            LEAF_MODEL_LOAD_ERROR = str(e)
            print(f"Warning: Failed to load leaf model from {candidate}: {e}")

    if model is None:
        if any(os.path.exists(path) for path in LEAF_MODEL_CANDIDATES):
            print(f"Warning: Leaf model file exists but could not be loaded. Last error: {LEAF_MODEL_LOAD_ERROR}")
        else:
            print(f"Warning: No leaf model file found. Checked: {LEAF_MODEL_CANDIDATES}")
except Exception as exc:
    TENSORFLOW_IMPORT_ERROR = str(exc)
    TENSORFLOW_AVAILABLE = False
    model = None
    fruit_model = None
    load_model = None
    print(f"Warning: TensorFlow/Keras unavailable. Running in mock mode. Details: {TENSORFLOW_IMPORT_ERROR}")


def load_model_if_exists(model_path):
    if not TENSORFLOW_AVAILABLE:
        return None
    if os.path.exists(model_path):
        try:
            return load_model(model_path)
        except Exception as exc:
            print(f"Warning: Failed to load model {model_path}: {exc}")
            return None
    return None


FRUIT_MODEL_LOAD_ERROR = None


def load_fruit_model_safely():
    global FRUIT_MODEL_LOAD_ERROR
    if not TENSORFLOW_AVAILABLE:
        detail = f" Details: {TENSORFLOW_IMPORT_ERROR}" if TENSORFLOW_IMPORT_ERROR else ""
        FRUIT_MODEL_LOAD_ERROR = "TensorFlow/Keras is not available in current Python environment." + detail
        return None

    print("Loading fruit model...")
    if not os.path.exists(FRUIT_MODEL_PATH):
        FRUIT_MODEL_LOAD_ERROR = f"Fruit model file not found at {FRUIT_MODEL_PATH}"
        print(FRUIT_MODEL_LOAD_ERROR)
        return None

    try:
        loaded_model = keras.models.load_model(
            FRUIT_MODEL_PATH,
            compile=False,
            custom_objects=MODEL_CUSTOM_OBJECTS,
        )
        FRUIT_MODEL_LOAD_ERROR = None
        print("Model loaded successfully")
        return loaded_model
    except Exception as exc:
        FRUIT_MODEL_LOAD_ERROR = f"Failed to load fruit model: {exc}"
        print(FRUIT_MODEL_LOAD_ERROR)
        return None


fruit_model = load_fruit_model_safely()

if os.path.exists(CLASS_NAMES_PATH):
    with open(CLASS_NAMES_PATH, "r", encoding="utf-8") as f:
        CLASS_NAMES = json.load(f)
else:
    CLASS_NAMES = ["Unknown"]  # Fallback
    print(f"Warning: Class names file not found at {CLASS_NAMES_PATH}")

if os.path.exists(FRUIT_CLASS_NAMES_PATH):
    with open(FRUIT_CLASS_NAMES_PATH, "r", encoding="utf-8") as f:
        FRUIT_CLASS_NAMES = json.load(f)
else:
    FRUIT_CLASS_NAMES = []
    print(f"Warning: Fruit class names file not found at {FRUIT_CLASS_NAMES_PATH}")

SOLUTIONS = {
    "Apple___Apple_scab": "Remove and destroy infected leaves. Spray a fungicide such as captan or myclobutanil at 7-10 day intervals during wet periods. Prune canopy for airflow and avoid overhead irrigation.",
    "Apple___Black_rot": "Prune infected twigs and remove mummified fruits. Spray a recommended fungicide (captan or mancozeb-based) on schedule. Keep orchard floor clean to reduce reinfection.",
    "Apple___Cedar_apple_rust": "Remove nearby juniper hosts if possible. Apply preventive fungicide at pink bud through petal-fall stages. Prune for airflow and monitor new lesions weekly.",
    "Apple___healthy": "Plant appears healthy. Continue routine scouting, balanced nutrition, and preventive sanitation.",
    "Potato___Early_blight": "Remove heavily infected lower leaves. Spray chlorothalonil or mancozeb as labeled. Maintain plant spacing and avoid prolonged leaf wetness.",
    "Potato___Late_blight": "Immediately remove infected plants/leaves and avoid moving wet foliage between fields. Apply late-blight specific fungicide (metalaxyl or cymoxanil mixes) as per label and repeat at short intervals in humid weather.",
    "Potato___healthy": "Plant appears healthy. Maintain crop rotation, balanced fertilizer, and regular scouting.",
    "Tomato___Tomato_mosaic_virus": "There is no curative spray for mosaic virus. Remove infected plants, disinfect tools and hands, control weeds, and use resistant seed/varieties in the next cycle."
}
IMAGE_SIZE = (224, 224)


def model_expects_normalized_input(loaded_model):
    first_layer = loaded_model.layers[0] if loaded_model and loaded_model.layers else None
    if first_layer and first_layer.__class__.__name__ == "Rescaling":
        return False
    return True


def preprocess_image(file_stream, loaded_model):
    image = Image.open(file_stream).convert("RGB")
    image = image.resize(IMAGE_SIZE)
    image_array = np.array(image, dtype=np.float32)
    if model_expects_normalized_input(loaded_model):
        image_array = image_array / 255.0
    image_array = np.expand_dims(image_array, axis=0)
    return image_array


def predict_with_model(file_stream, loaded_model, class_names):
    image_tensor = preprocess_image(file_stream, loaded_model)
    predictions = loaded_model.predict(image_tensor, verbose=0)
    predictions = np.squeeze(predictions)

    if np.isscalar(predictions):
        predictions = np.array([float(predictions)], dtype=np.float32)

    predictions = np.asarray(predictions, dtype=np.float32)
    pred_sum = float(np.sum(predictions))
    if pred_sum > 0:
        predictions = predictions / pred_sum

    score = float(np.max(predictions)) if predictions.size else 0.0
    index = int(np.argmax(predictions)) if predictions.size else 0
    disease = class_names[index] if index < len(class_names) else f"class_{index}"
    return disease, score


@app.route("/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided."}), 400

    file = request.files["image"]
    try:
        if not TENSORFLOW_AVAILABLE or model is None:
            # Mock prediction when TensorFlow/model not available
            compatibility_note = ""
            if LEAF_MODEL_LOAD_ERROR:
                compatibility_note = f" Load error: {LEAF_MODEL_LOAD_ERROR}"
            if TENSORFLOW_IMPORT_ERROR:
                compatibility_note += f" Import error: {TENSORFLOW_IMPORT_ERROR}"
            return jsonify({
                "disease": "Mock: Tomato___healthy",
                "confidence": 0.85,
                "solution": "Trained leaf model was not loaded. The file may be incompatible with the installed TensorFlow/Keras version." + compatibility_note,
                "details": LEAF_MODEL_LOAD_ERROR or TENSORFLOW_IMPORT_ERROR,
                "note": "Fallback mock response"
            })

        disease, score = predict_with_model(file, model, CLASS_NAMES)

        solution = SOLUTIONS.get(
            disease,
            "This result comes from the trained plant disease model. If confidence is low, verify with a plant health expert."
        )

        return jsonify({
            "disease": disease,
            "confidence": score,
            "solution": solution
        })
    except Exception as exc:
        return jsonify({"error": f"Prediction failed: {str(exc)}"}), 500


@app.route("/predict-fruit", methods=["POST"])
def predict_fruit():
    print("[Python API] /predict-fruit request received")
    if "image" not in request.files:
        print("[Python API] Missing image in request")
        return jsonify({"error": "No image file provided."}), 400

    if not TENSORFLOW_AVAILABLE:
        print("[Python API] TensorFlow unavailable")
        detail = TENSORFLOW_IMPORT_ERROR or "TensorFlow/Keras is not available in current Python environment."
        return jsonify({"error": "Fruit model not loaded properly", "details": detail}), 503

    if not os.path.exists(FRUIT_MODEL_PATH):
        missing_path_error = f"Fruit model file not found at {FRUIT_MODEL_PATH}"
        print(f"[Python API] {missing_path_error}")
        return jsonify({"error": "Fruit model not loaded properly", "details": missing_path_error}), 503

    if fruit_model is None:
        print("[Python API] fruit_model.h5 not loaded")
        return jsonify({
            "error": "Fruit model not loaded properly",
            "details": FRUIT_MODEL_LOAD_ERROR or "Unknown fruit model load error."
        }), 503

    if not FRUIT_CLASS_NAMES:
        print("[Python API] fruit_class_names.json missing or empty")
        return jsonify({"error": "Fruit model not loaded properly", "details": "fruit_class_names.json is missing or empty."}), 503

    try:
        file = request.files["image"]
        disease, confidence = predict_with_model(file, fruit_model, FRUIT_CLASS_NAMES)

        return jsonify({
            "disease": disease,
            "confidence": confidence,
            "suggestion": "Use crop-specific fungicide guidance for this fruit disease."
        })
    except Exception as exc:
        print(f"[Python API] Prediction error: {exc}")
        return jsonify({"error": "Fruit model not loaded properly", "details": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
