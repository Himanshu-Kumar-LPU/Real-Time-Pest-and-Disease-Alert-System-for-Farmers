import zipfile
import io
from pathlib import Path
import h5py

path = Path('trained_model.keras')
print('exists', path.exists(), 'size', path.stat().st_size)
with zipfile.ZipFile(path, 'r') as z:
    print('archive entries', z.namelist())
    with z.open('model.weights.h5') as f:
        data = f.read()
        with h5py.File(io.BytesIO(data), 'r') as hf:
            print('weights groups', list(hf.keys())[:50])
            print('conv2d present', any('conv2d' in k for k in hf.keys()))
