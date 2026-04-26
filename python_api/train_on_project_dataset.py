#!/usr/bin/env python3
"""
Train a plant disease classification model on the Dataset folder in the project root.

Usage: python train_on_project_dataset.py
"""

import json
from pathlib import Path

import tensorflow as tf
from tensorflow.keras import layers, models, callbacks

# Image size expected by the model and also by app.py
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 16
AUTOTUNE = tf.data.AUTOTUNE


def build_model(input_shape=(224, 224, 3), num_classes=6):
    """Build a simple convolutional neural network for image classification."""
    return models.Sequential([
        layers.Rescaling(1.0 / 255, input_shape=input_shape),
        layers.Conv2D(32, 3, activation='relu'),
        layers.MaxPooling2D(),
        layers.Conv2D(64, 3, activation='relu'),
        layers.MaxPooling2D(),
        layers.Conv2D(128, 3, activation='relu'),
        layers.MaxPooling2D(),
        layers.Flatten(),
        layers.Dropout(0.3),
        layers.Dense(128, activation='relu'),
        layers.Dense(num_classes, activation='softmax')
    ])


def get_datasets(data_dir, image_size=IMAGE_SIZE, batch_size=BATCH_SIZE):
    """Load datasets from train and valid subdirectories."""
    data_dir = Path(data_dir)
    train_dir = data_dir / 'train'
    valid_dir = data_dir / 'valid'

    if not train_dir.exists() or not valid_dir.exists():
        raise FileNotFoundError(f'Dataset must have train/ and valid/ subdirectories at {data_dir}')

    print('Loading training dataset from:', train_dir)
    raw_train_ds = tf.keras.utils.image_dataset_from_directory(
        train_dir,
        image_size=image_size,
        batch_size=batch_size,
        label_mode='categorical',
        shuffle=True,
        seed=123
    )

    print('Loading validation dataset from:', valid_dir)
    raw_val_ds = tf.keras.utils.image_dataset_from_directory(
        valid_dir,
        image_size=image_size,
        batch_size=batch_size,
        label_mode='categorical',
        shuffle=False,
        seed=123,
        class_names=raw_train_ds.class_names
    )

    class_names = raw_train_ds.class_names
    train_ds = raw_train_ds.cache().prefetch(buffer_size=AUTOTUNE)
    val_ds = raw_val_ds.cache().prefetch(buffer_size=AUTOTUNE)

    return train_ds, val_ds, class_names


def main():
    """Train model on project Dataset folder."""
    base_dir = Path(__file__).resolve().parent
    project_root = base_dir.parent
    data_dir = project_root / 'Dataset'
    output_path = base_dir / 'models' / 'leaf_model.keras'
    class_names_path = base_dir / 'class_names.json'
    
    # Ensure models directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not data_dir.exists() or not data_dir.is_dir():
        raise FileNotFoundError(f'Dataset directory not found at: {data_dir}')

    print('=' * 60)
    print('Plant Disease Classification Model Training')
    print('=' * 60)
    print(f'Dataset directory: {data_dir}')
    print(f'Model output: {output_path}')
    print(f'Class names output: {class_names_path}')
    print(f'Image size: {IMAGE_SIZE}')
    print(f'Batch size: {BATCH_SIZE}')
    print('=' * 60)

    # Load datasets
    train_ds, val_ds, class_names = get_datasets(data_dir, IMAGE_SIZE, BATCH_SIZE)
    print(f'\nDetected {len(class_names)} disease classes:')
    for idx, cls in enumerate(class_names, 1):
        print(f'  {idx}. {cls}')

    # Build model
    print(f'\nBuilding model for {len(class_names)} classes...')
    model = build_model(input_shape=(*IMAGE_SIZE, 3), num_classes=len(class_names))
    model.compile(
        optimizer='adam',
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )

    # Train model
    print('\nStarting training...')
    checkpoint = callbacks.ModelCheckpoint(
        str(output_path),
        monitor='val_accuracy',
        save_best_only=True,
        verbose=1
    )

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=25,
        callbacks=[checkpoint],
        verbose=1
    )

    # Save if not already saved by checkpoint
    if not output_path.exists():
        print(f'Saving model to {output_path}...')
        model.save(str(output_path))

    # Save class names
    class_names_path.write_text(json.dumps(class_names, indent=2), encoding='utf-8')
    print(f'Saved class names to {class_names_path}')

    print('\n' + '=' * 60)
    print('Training Complete!')
    print('=' * 60)
    print(f'Final Training Accuracy: {history.history["accuracy"][-1]:.4f}')
    print(f'Final Validation Accuracy: {history.history["val_accuracy"][-1]:.4f}')
    print(f'\nModel saved to: {output_path}')
    print(f'Class names saved to: {class_names_path}')
    print('=' * 60)


if __name__ == '__main__':
    main()
