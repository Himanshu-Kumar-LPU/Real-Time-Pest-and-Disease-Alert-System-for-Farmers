# Plant Disease Analysis Setup Guide

## Overview
Your project is now configured to analyze plant diseases using a deep learning model trained on your **Dataset** folder.

## Dataset Structure
Your dataset is organized as follows:

```
Dataset/
├── train/                         (15,205 training images)
│   ├── Apple___Apple_scab/
│   ├── Apple___Black_rot/
│   ├── Apple___healthy/
│   ├── Potato___Early_blight/
│   ├── Potato___Late_blight/
│   ├── Potato___healthy/
│   └── Tomato___Tomato_mosaic_virus/
└── valid/                         (3,377 validation images)
    ├── Apple___Apple_scab/
    ├── Apple___Black_rot/
    ├── Apple___Cedar_apple_rust/
    ├── Apple___healthy/
    ├── Potato___Early_blight/
    ├── Potato___healthy/
    ├── Potato___Late_blight/
    └── Tomato___Tomato_mosaic_virus/
```

## Training the Model

### Using the Training Script
A new training script has been created to use your Dataset folder:

```bash
cd python_api
./.venv311/Scripts/python.exe train_on_project_dataset.py
```

This script will:
- Load images from `Dataset/train` and `Dataset/valid`
- Train a CNN model on 7 disease classes
- Save the trained model to `python_api/models/leaf_model.keras`
- Save class names to `python_api/class_names.json`
- Train for 25 epochs with validation monitoring

**Training Status**: The script is currently running. It will take 2-3 hours to complete depending on your system.

## Using the Trained Model

### 1. Command Line Analysis
Once training is complete, analyze individual images:

```bash
cd python_api
./.venv311/Scripts/python.exe analyze_image_api.py /path/to/image.jpg
```

**Output Example**:
```json
{
  "type": "leaf",
  "model_used": "leaf_model (trained on Dataset folder)",
  "disease": "Tomato___Late_blight",
  "confidence": 0.92,
  "suggestion": "Spray copper fungicide, remove infected leaves, and avoid overhead irrigation.",
  "low_confidence": false,
  "top_predictions": [
    {"name": "Tomato___Late_blight", "confidence": 0.92},
    {"name": "Tomato___Tomato_mosaic_virus", "confidence": 0.07},
    {"name": "Potato___Early_blight", "confidence": 0.01}
  ],
  "meta": {
    "model_path": "C:\\...\\models\\leaf_model.keras",
    "input_size": [224, 224]
  }
}
```

### 2. Flask API
Start the Flask API server to handle image uploads via HTTP:

```bash
cd python_api
./.venv311/Scripts/python.exe app.py
```

The API will run on `http://localhost:5000` and accept image uploads.

### 3. Integration with Backend
The backend/server.js can make requests to the Python API to analyze plant images.

## Disease Classes & Recommendations

The model recognizes the following diseases:

| Disease | Recommendation |
|---------|-----------------|
| **Apple___Apple_scab** | Apply fungicide spray regularly, prune infected branches |
| **Apple___Black_rot** | Prune infected twigs and use fungicide during humid weather |
| **Apple___healthy** | Continue routine scouting and balanced nutrition |
| **Potato___Early_blight** | Use mancozeb-based fungicide, improve air circulation |
| **Potato___Late_blight** | Spray copper fungicide, remove infected leaves |
| **Potato___healthy** | Monitor for 2-3 days and consult local agriculture expert |
| **Tomato___Tomato_mosaic_virus** | Remove infected plants, sanitize tools between plants |

## Model Details

- **Architecture**: Convolutional Neural Network (CNN)
- **Input Size**: 224×224 pixels
- **Training**: 25 epochs with validation monitoring
- **Optimizer**: Adam
- **Loss Function**: Categorical Crossentropy
- **Classes**: 7 plant disease/health categories

## Files Generated After Training

Once training completes, you will have:

```
python_api/
├── models/
│   └── leaf_model.keras          (Trained model - ~20MB)
├── class_names.json               (Disease class labels)
├── train_on_project_dataset.py    (Training script)
├── analyze_image_api.py           (Analysis script)
├── app.py                         (Flask API server)
└── requirements.txt
```

## Troubleshooting

### Training Issues
- **GPU not available**: Model will train on CPU (slower but still works)
- **Out of memory**: Reduce `BATCH_SIZE` in training script from 16 to 8
- **Import errors**: Ensure all packages are installed: `pip install -r requirements.txt`

### Analysis Issues
- **Low confidence results**: Upload clearer images with better focus
- **Model not found**: Ensure training has completed and model file exists
- **Misclassification**: More training epochs or additional data may improve accuracy

## Next Steps

1. ✅ Training script created - currently running
2. ⏳ Wait for training to complete (check terminal output)
3. ✅ API configured to use trained model
4. 📤 Upload plant images through frontend or API
5. 📊 Receive disease predictions with confidence scores

## Integration Example

```javascript
// Frontend (JavaScript)
const formData = new FormData();
formData.append('image', imageFile);

fetch('/api/analyze', {
  method: 'POST',
  body: formData
})
.then(res => res.json())
.then(data => {
  console.log('Disease:', data.disease);
  console.log('Confidence:', data.confidence);
  console.log('Suggestion:', data.suggestion);
});
```

## References

- **Dataset**: `../../Dataset/` - Your plant disease images
- **Model Code**: `train_on_project_dataset.py` - Training pipeline
- **Analysis Code**: `analyze_image_api.py` - Image classification
- **API Code**: `app.py` - Flask REST API

---

**Last Updated**: Training in progress
**Model Status**: Training (Epoch 2+/25)
