#!/usr/bin/env python3
"""
Plant Disease Analysis API - can be called from Node.js backend
Usage: python analyze_image_api.py <image_path>
Returns JSON with disease, confidence, and solution
"""

import sys
import json
import os
import io
import zipfile
import numpy as np
from pathlib import Path
import tensorflow as tf
import h5py
from PIL import Image

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent
MODEL_PATH = SCRIPT_DIR / "trained_model.keras"

# Disease classes for the trained model
CLASS_NAMES = [
    'Apple___Apple_scab',
    'Apple___Black_rot',
    'Apple___Cedar_apple_rust',
    'Apple___healthy',
    'Blueberry___healthy',
    'Cherry_(including_sour)___Powdery_mildew',
    'Cherry_(including_sour)___healthy',
    'Corn_(maize)___Cercospora_leaf_spot_Gray_leaf_spot',
    'Corn_(maize)___Common_rust_',
    'Corn_(maize)___Northern_Leaf_Blight',
    'Corn_(maize)___healthy',
    'Grape___Black_rot',
    'Grape___Esca_(Black_Measles)',
    'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)',
    'Grape___healthy',
    'Orange___Haunglongbing_(Citrus_greening)',
    'Peach___Bacterial_spot',
    'Peach___healthy',
    'Pepper,_bell___Bacterial_spot',
    'Pepper,_bell___healthy',
    'Potato___Early_blight',
    'Potato___Late_blight',
    'Potato___healthy',
    'Raspberry___healthy',
    'Soybean___healthy',
    'Squash___Powdery_mildew',
    'Strawberry___Leaf_scorch',
    'Strawberry___healthy',
    'Tomato___Bacterial_spot',
    'Tomato___Early_blight',
    'Tomato___Late_blight',
    'Tomato___Leaf_Mold',
    'Tomato___Septoria_leaf_spot',
    'Tomato___Spider_mites_Two-spotted_spider_mite',
    'Tomato___Target_Spot',
    'Tomato___Tomato_Yellow_Leaf_Curl_Virus',
    'Tomato___Tomato_mosaic_virus',
    'Tomato___healthy'
]

# Preferred guidance for some common classes
DISEASE_INFO = {
    0: {"name": "Apple Apple Scab", "solution": "Remove infected fruit and leaves, improve air circulation, and apply fungicide as recommended."},
    1: {"name": "Apple Black Rot", "solution": "Prune infected branches, remove fallen fruit, and use a copper-based spray."},
    2: {"name": "Apple Cedar Apple Rust", "solution": "Remove nearby junipers, apply fungicide, and keep leaves dry."},
    3: {"name": "Apple Healthy", "solution": "The apple leaf appears healthy. Continue regular monitoring and care."},
    4: {"name": "Blueberry Healthy", "solution": "The plant appears healthy. Maintain good watering and nutrition."},
    21: {"name": "Potato Late Blight", "solution": "Destroy infected plants, avoid wet soil, and apply mancozeb or copper fungicide."},
    22: {"name": "Potato Healthy", "solution": "The potato plant appears healthy. Keep a balanced watering schedule."},
    29: {"name": "Tomato Bacterial Spot", "solution": "Remove affected leaves, avoid overhead watering, and apply copper fungicide."},
    30: {"name": "Tomato Early Blight", "solution": "Remove infected leaves, improve ventilation, and use a copper-based fungicide."},
    31: {"name": "Tomato Late Blight", "solution": "Destroy infected plants, avoid planting in wet soil, and apply mancozeb or copper fungicide."},
    32: {"name": "Tomato Leaf Mold", "solution": "Improve air circulation, remove infected foliage, and apply a fungicide."},
    37: {"name": "Tomato Healthy", "solution": "The tomato plant appears healthy. Continue normal care."},
}

def load_model():
    """Load the trained Keras model from a .keras archive."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found at {MODEL_PATH}")

    with zipfile.ZipFile(MODEL_PATH, 'r') as archive:
        config_bytes = archive.read('config.json')
        weights_bytes = archive.read('model.weights.h5')

    model_config = json.loads(config_bytes)
    model = tf.keras.models.model_from_config(model_config)

    with h5py.File(io.BytesIO(weights_bytes), 'r') as hf:
        if 'layers' in hf:
            for layer in model.layers:
                if layer.name in hf['layers']:
                    layer_group = hf['layers'][layer.name]
                    if 'vars' in layer_group:
                        weight_vars = layer_group['vars']
                        weights = [weight_vars[name][()] for name in sorted(weight_vars.keys(), key=lambda x: int(x) if x.isdigit() else x)]
                        if weights:
                            layer.set_weights(weights)

    return model

def preprocess_image(image_path, target_size=(128, 128)):
    """Preprocess image for model prediction."""
    img = Image.open(image_path).convert('RGB')
    img = img.resize(target_size, Image.LANCZOS)
    img_array = np.array(img) / 255.0
    img_array = np.expand_dims(img_array, axis=0)
    return img_array


def format_class_name(class_name):
    return class_name.replace('___', ' ').replace('_', ' ').replace('  ', ' ').strip()


def analyze_image(image_path):
    """Analyze image and return disease prediction."""
    try:
        # Load model
        model = load_model()
        
        # Preprocess image
        img_array = preprocess_image(image_path)
        
        # Make prediction
        predictions = model.predict(img_array, verbose=0)[0]
        sorted_indices = np.argsort(predictions)[::-1]
        predicted_class = int(sorted_indices[0])
        confidence = float(predictions[predicted_class]) * 100
        
        top_predictions = []
        for idx in sorted_indices[:3]:
            class_name = CLASS_NAMES[idx] if idx < len(CLASS_NAMES) else "Unknown"
            top_predictions.append({
                "class": int(idx),
                "name": format_class_name(class_name),
                "confidence": float(predictions[idx] * 100)
            })

        class_name = CLASS_NAMES[predicted_class] if predicted_class < len(CLASS_NAMES) else "Unknown"
        disease_info = DISEASE_INFO.get(predicted_class, {
            "name": format_class_name(class_name),
            "solution": "This looks like a plant disease prediction from the model. If confidence is low, please verify with a plant health expert."
        })

        if confidence < 20:
            disease_info["solution"] = (
                "The model is not very confident in this prediction. "
                "Please use a clear leaf image and verify the result with an expert."
            )

        return {
            "disease": disease_info["name"],
            "confidence": f"{confidence:.1f}%",
            "solution": disease_info["solution"],
            "class": int(predicted_class),
            "raw_confidence": confidence,
            "top_predictions": top_predictions
        }
    except Exception as e:
        return {
            "error": str(e),
            "disease": None,
            "confidence": None,
            "solution": None
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Image path required"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    if not Path(image_path).exists():
        print(json.dumps({"error": f"Image file not found: {image_path}"}))
        sys.exit(1)
    
    result = analyze_image(image_path)
    print(json.dumps(result))
