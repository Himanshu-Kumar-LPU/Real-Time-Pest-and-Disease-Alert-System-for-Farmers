import argparse
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
    data_dir = Path(data_dir)
    train_dir = data_dir / 'train'
    valid_dir = data_dir / 'valid'

    if train_dir.exists() and valid_dir.exists():
        print('Using existing train/valid split from dataset root.')
        raw_train_ds = tf.keras.utils.image_dataset_from_directory(
            train_dir,
            image_size=image_size,
            batch_size=batch_size,
            label_mode='categorical',
            shuffle=True,
            seed=123
        )
        raw_val_ds = tf.keras.utils.image_dataset_from_directory(
            valid_dir,
            image_size=image_size,
            batch_size=batch_size,
            label_mode='categorical',
            shuffle=False,
            seed=123,
            class_names=raw_train_ds.class_names
        )
    else:
        print('Using dataset root with automatic validation split.')
        raw_train_ds = tf.keras.utils.image_dataset_from_directory(
            data_dir,
            validation_split=0.2,
            subset='training',
            seed=123,
            image_size=image_size,
            batch_size=batch_size,
            label_mode='categorical'
        )
        raw_val_ds = tf.keras.utils.image_dataset_from_directory(
            data_dir,
            validation_split=0.2,
            subset='validation',
            seed=123,
            image_size=image_size,
            batch_size=batch_size,
            label_mode='categorical'
        )

    class_names = raw_train_ds.class_names
    train_ds = raw_train_ds.cache().prefetch(buffer_size=AUTOTUNE)
    val_ds = raw_val_ds.cache().prefetch(buffer_size=AUTOTUNE)

    return train_ds, val_ds, class_names


def main():
    parser = argparse.ArgumentParser(description='Train plant disease image classification model')
    parser.add_argument('--data_dir', type=str, default='../Plant_Disease_Dataset',
                        help='Path to the dataset directory containing train/valid subfolders')
    parser.add_argument('--output', type=str, default='plant_model.keras',
                        help='Output model file path')
    parser.add_argument('--epochs', type=int, default=20,
                        help='Number of training epochs')
    parser.add_argument('--batch_size', type=int, default=BATCH_SIZE,
                        help='Batch size for training')
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    data_dir = (base_dir / args.data_dir).resolve()
    output_path = (base_dir / args.output).resolve()
    class_names_path = base_dir / 'class_names.json'

    if not data_dir.exists() or not data_dir.is_dir():
        raise FileNotFoundError(f'Dataset directory not found: {data_dir}')

    print('Dataset directory:', data_dir)
    print('Saving model to:', output_path)
    print('Saving class names to:', class_names_path)
    print('Epochs:', args.epochs)
    print('Batch size:', args.batch_size)

    train_ds, val_ds, class_names = get_datasets(data_dir, IMAGE_SIZE, args.batch_size)
    print('Detected classes:', class_names)

    model = build_model(input_shape=(*IMAGE_SIZE, 3), num_classes=len(class_names))
    model.compile(
        optimizer='adam',
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )

    checkpoint = callbacks.ModelCheckpoint(
        output_path,
        monitor='val_accuracy',
        save_best_only=True,
        verbose=1
    )

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs,
        callbacks=[checkpoint]
    )

    if not output_path.exists():
        model.save(output_path)

    class_names_path.write_text(json.dumps(class_names, indent=2), encoding='utf-8')

    print('Training complete. Model saved to:', output_path)
    print('Class names saved to:', class_names_path)
    print('Final metrics:')
    for metric, values in history.history.items():
        print(f'  {metric}: {values[-1]:.4f}')


if __name__ == '__main__':
    main()
