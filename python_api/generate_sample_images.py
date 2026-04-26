import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

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

# Image dimensions
IMG_SIZE = 224
NUM_IMAGES_PER_CLASS = 30


def create_sample_image(class_name, index):
    """Generate a sample image for a disease class."""
    img = Image.new('RGB', (IMG_SIZE, IMG_SIZE), color=(random.randint(50, 150), random.randint(100, 200), random.randint(50, 100)))
    draw = ImageDraw.Draw(img)
    
    # Add random shapes to simulate disease patterns
    if "Blight" in class_name:
        # Dark brown spots for blight
        for _ in range(random.randint(5, 15)):
            x = random.randint(0, IMG_SIZE)
            y = random.randint(0, IMG_SIZE)
            size = random.randint(10, 40)
            draw.ellipse([x, y, x + size, y + size], fill=(60, 40, 20))
    
    elif "Leaf Mold" in class_name:
        # Grayish patterns for mold
        for _ in range(random.randint(3, 10)):
            x = random.randint(0, IMG_SIZE)
            y = random.randint(0, IMG_SIZE)
            size = random.randint(15, 50)
            draw.rectangle([x, y, x + size, y + size], fill=(120, 120, 130))
    
    elif "Healthy" in class_name:
        # Lighter green with minimal spots
        img = Image.new('RGB', (IMG_SIZE, IMG_SIZE), color=(100, 180, 80))
        draw = ImageDraw.Draw(img)
        for _ in range(random.randint(0, 2)):
            x = random.randint(0, IMG_SIZE)
            y = random.randint(0, IMG_SIZE)
            size = random.randint(3, 8)
            draw.ellipse([x, y, x + size, y + size], fill=(110, 200, 90))
    
    # Apply blur to make it look more realistic
    img = img.filter(ImageFilter.GaussianBlur(radius=2))
    
    return img


def generate_sample_images():
    """Generate sample images for all disease classes."""
    for class_name in CLASSES:
        class_dir = DATASET_DIR / class_name
        class_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"Generating {NUM_IMAGES_PER_CLASS} sample images for: {class_name}")
        
        for i in range(NUM_IMAGES_PER_CLASS):
            img = create_sample_image(class_name, i)
            img_path = class_dir / f"sample_{i:03d}.jpg"
            img.save(img_path)
            print(f"  ✓ Created: {img_path.name}")
    
    print(f"\n✅ Generated {len(CLASSES) * NUM_IMAGES_PER_CLASS} total sample images")
    print(f"Location: {DATASET_DIR}")


if __name__ == "__main__":
    generate_sample_images()
