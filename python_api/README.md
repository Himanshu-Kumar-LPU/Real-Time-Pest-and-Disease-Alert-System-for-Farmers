# Plant Disease Model Training

This folder contains the Flask prediction API and the training script for the image analysis model.

## Files

- `app.py` - Flask API for image prediction using a trained TensorFlow model.
- `train_model.py` - Training script that creates `plant_model.h5` from labeled images.
- `requirements.txt` - Python dependencies.

## Dataset structure

This project can also train directly from the provided `Plant_Disease_Dataset` at the repo root. The dataset already contains `train/`, `valid/`, and `test/` folders, with one class subfolder per disease.

If you want to use a custom dataset folder, create a folder with one subfolder per class:

```
python_api/
  dataset/
    Apple___Apple_scab/
    Apple___Black_rot/
    Apple___Cedar_apple_rust/
    Apple___healthy/
    ...
```

For the existing dataset, run the training script from `python_api` like this:

```powershell
python train_model.py --data_dir "../Plant_Disease_Dataset" --epochs 20
```

This will detect the `train/` and `valid/` directories automatically, train the model, and save:
- `plant_model.h5`
- `class_names.json`

## Install dependencies

Use a Python environment, then install:

```powershell
cd "c:\Users\Himanshu Kumar\OneDrive\Desktop\project\python_api"
pip install -r requirements.txt
pip install -r requirements-keras.txt
```

On Windows, you can also run the bundled setup script after creating the venv:

```powershell
./setup_ml_env.ps1
```

## Train the model

Run the training script from the `python_api` folder:

```powershell
python train_model.py --epochs 20
```

This will:
- read images from `dataset/`
- split data into training and validation sets
- train a CNN model
- save the best model as `plant_model.h5`

If you want more training time, increase `--epochs`.

## Use the trained model

After training, make sure `plant_model.h5` exists in `python_api/`.

Then run the Flask API:

```powershell
python app.py
```

The API will be available at `http://0.0.0.0:5000` and can accept image uploads at `/predict`.

## Notes

- The image size is fixed at `224x224`.
- The class names are derived from subfolder names in `dataset/`.
- If the model file is missing, `app.py` will raise an error.
