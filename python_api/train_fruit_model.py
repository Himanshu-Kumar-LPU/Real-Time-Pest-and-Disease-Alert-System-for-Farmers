import argparse
import json
from pathlib import Path

import tensorflow as tf
from tensorflow.keras import layers, callbacks

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
AUTOTUNE = tf.data.AUTOTUNE


def build_model(num_classes):
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3),
        include_top=False,
        weights="imagenet"
    )
    base_model.trainable = False

    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = tf.keras.applications.mobilenet_v2.preprocess_input(inputs)
    x = base_model(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(num_classes, activation="softmax")(x)

    model = tf.keras.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model


def create_datasets(data_dir, batch_size):
    train_ds = tf.keras.utils.image_dataset_from_directory(
        data_dir,
        validation_split=0.2,
        subset="training",
        seed=42,
        image_size=IMAGE_SIZE,
        batch_size=batch_size,
        label_mode="categorical"
    )

    val_ds = tf.keras.utils.image_dataset_from_directory(
        data_dir,
        validation_split=0.2,
        subset="validation",
        seed=42,
        image_size=IMAGE_SIZE,
        batch_size=batch_size,
        label_mode="categorical"
    )

    augment = tf.keras.Sequential([
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.1),
        layers.RandomZoom(0.1),
        layers.RandomContrast(0.1),
    ])

    train_ds = train_ds.map(lambda x, y: (augment(x, training=True), y), num_parallel_calls=AUTOTUNE)
    train_ds = train_ds.prefetch(AUTOTUNE)
    val_ds = val_ds.prefetch(AUTOTUNE)

    return train_ds, val_ds, train_ds.class_names


def main():
    parser = argparse.ArgumentParser(description="Train fruit disease classifier")
    parser.add_argument("--data_dir", type=str, default="../dataset/fruit", help="Fruit dataset directory")
    parser.add_argument("--epochs", type=int, default=15, help="Training epochs")
    parser.add_argument("--batch_size", type=int, default=BATCH_SIZE, help="Batch size")
    parser.add_argument("--output", type=str, default="models/fruit_model.h5", help="Saved model path")
    parser.add_argument("--classes_output", type=str, default="models/fruit_class_names.json", help="Saved classes json path")
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    data_dir = (base_dir / args.data_dir).resolve()
    output_model = (base_dir / args.output).resolve()
    classes_output = (base_dir / args.classes_output).resolve()

    if not data_dir.exists() or not data_dir.is_dir():
        raise FileNotFoundError(f"Dataset directory not found: {data_dir}")

    train_ds, val_ds, class_names = create_datasets(str(data_dir), args.batch_size)
    if len(class_names) < 2:
        raise RuntimeError("At least 2 fruit classes are required for training.")

    model = build_model(num_classes=len(class_names))

    output_model.parent.mkdir(parents=True, exist_ok=True)
    classes_output.parent.mkdir(parents=True, exist_ok=True)

    checkpoint = callbacks.ModelCheckpoint(
        filepath=str(output_model),
        monitor="val_accuracy",
        save_best_only=True,
        verbose=1
    )
    early_stop = callbacks.EarlyStopping(
        monitor="val_accuracy",
        patience=4,
        restore_best_weights=True,
        verbose=1
    )

    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs,
        callbacks=[checkpoint, early_stop]
    )

    if not output_model.exists():
        model.save(str(output_model))

    classes_output.write_text(json.dumps(class_names, indent=2), encoding="utf-8")

    print("Fruit model saved:", output_model)
    print("Fruit class names saved:", classes_output)


if __name__ == "__main__":
    main()
