import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATASET_DIR = BASE_DIR / "dataset"
CLASSES = [
    "Tomato Early Blight",
    "Tomato Late Blight",
    "Tomato Leaf Mold",
    "Potato Early Blight",
    "Potato Late Blight",
    "Healthy",
]

PLACEHOLDER_TEXT = (
    "Add your training images for this class here.\n"
    "Each image should be in JPEG or PNG format.\n"
    "Do not include subfolders here.\n"
)


def create_structure():
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    for class_name in CLASSES:
        class_dir = DATASET_DIR / class_name
        class_dir.mkdir(parents=True, exist_ok=True)
        readme_file = class_dir / "README.txt"
        if not readme_file.exists():
            readme_file.write_text(PLACEHOLDER_TEXT)
            print(f"Created: {readme_file}")
        else:
            print(f"Exists: {readme_file}")


if __name__ == "__main__":
    create_structure()
