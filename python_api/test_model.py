#!/usr/bin/env python3
"""
Quick test script to verify the trained model and analyze sample images.

Usage: python test_model.py [image_path]
If no image_path provided, looks for sample images in the Dataset folder.
"""

import json
import sys
from pathlib import Path

# Add parent directory to path to import analyze_image_api
sys.path.insert(0, str(Path(__file__).parent))

try:
    from analyze_image_api import analyze_image
except ImportError as e:
    print(f"Error: Could not import analyze_image_api: {e}")
    print("Make sure you're running this script from the python_api directory")
    sys.exit(1)


def test_with_sample_images():
    """Test with sample images from the Dataset folder."""
    project_root = Path(__file__).parent.parent
    dataset_valid = project_root / 'Dataset' / 'valid'
    
    if not dataset_valid.exists():
        print(f"❌ Dataset not found at {dataset_valid}")
        return False
    
    print("🔍 Looking for sample images in Dataset/valid/...\n")
    
    # Get one sample from each disease class
    results = []
    for disease_dir in sorted(dataset_valid.iterdir()):
        if not disease_dir.is_dir():
            continue
        
        # Get first image from this disease
        images = list(disease_dir.glob('*.jpg')) + list(disease_dir.glob('*.png'))
        if not images:
            print(f"⚠️  No images found in {disease_dir.name}")
            continue
        
        sample_image = images[0]
        print(f"📸 Testing: {disease_dir.name}")
        print(f"   Image: {sample_image.name}")
        
        try:
            result = analyze_image(sample_image)
            
            # Display results
            if 'error' in result:
                print(f"   ❌ Error: {result['error']}")
            else:
                disease = result.get('disease', 'Unknown')
                confidence = result.get('confidence', 0)
                suggestion = result.get('suggestion', '')
                
                print(f"   ✅ Detected: {disease}")
                print(f"   🎯 Confidence: {confidence * 100:.1f}%")
                print(f"   💡 Suggestion: {suggestion[:60]}...")
                
                if 'top_predictions' in result:
                    print(f"   📊 Top predictions:")
                    for pred in result['top_predictions'][:2]:
                        print(f"      - {pred['name']}: {pred['confidence'] * 100:.1f}%")
            
            results.append({
                'image': str(sample_image),
                'result': result
            })
            print()
        except Exception as e:
            print(f"   ❌ Exception: {e}\n")
    
    return len(results) > 0


def test_with_specific_image(image_path):
    """Test with a specific image file."""
    image_file = Path(image_path)
    
    if not image_file.exists():
        print(f"❌ Image file not found: {image_file}")
        return False
    
    print(f"🔍 Analyzing: {image_file.name}\n")
    
    try:
        result = analyze_image(image_file)
        
        print(json.dumps(result, indent=2))
        
        if 'error' not in result:
            print("\n" + "="*50)
            print("ANALYSIS RESULTS")
            print("="*50)
            print(f"Disease: {result.get('disease', 'Unknown')}")
            print(f"Confidence: {result.get('confidence', 0) * 100:.1f}%")
            print(f"Recommendation: {result.get('suggestion', 'N/A')}")
            print("="*50 + "\n")
        
        return True
    except Exception as e:
        print(f"❌ Error analyzing image: {e}")
        import traceback
        traceback.print_exc()
        return False


def check_model_exists():
    """Check if the trained model and class names exist."""
    model_path = Path(__file__).parent / 'models' / 'leaf_model.keras'
    classes_path = Path(__file__).parent / 'class_names.json'
    
    print("🔎 Checking for trained model files...\n")
    
    if model_path.exists():
        size_mb = model_path.stat().st_size / (1024 * 1024)
        print(f"✅ Model found: {model_path.name} ({size_mb:.1f} MB)")
    else:
        print(f"❌ Model not found: {model_path}")
        print("   Run: python train_on_project_dataset.py")
        return False
    
    if classes_path.exists():
        with open(classes_path) as f:
            classes = json.load(f)
        print(f"✅ Classes found: {len(classes)} disease categories")
        for i, cls in enumerate(classes, 1):
            print(f"   {i}. {cls}")
    else:
        print(f"❌ Classes file not found: {classes_path}")
        return False
    
    print()
    return True


def main():
    print("=" * 60)
    print("Plant Disease Model - Test Suite")
    print("=" * 60)
    print()
    
    # Check if model exists
    if not check_model_exists():
        print("\n⚠️  Model training not complete yet.")
        print("    The training script is still running.")
        print("    Check back later and run this test again.\n")
        return
    
    # Test with specific image or samples
    if len(sys.argv) > 1:
        print("Testing with specific image...\n")
        success = test_with_specific_image(sys.argv[1])
    else:
        print("Testing with sample images from Dataset/valid/...\n")
        success = test_with_sample_images()
    
    if success:
        print("✅ Model test completed successfully!")
    else:
        print("❌ Model test failed. Check the output above for errors.")


if __name__ == '__main__':
    main()
