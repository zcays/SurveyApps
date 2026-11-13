"""Generate real multi-resolution platform icons from the SVG rasterization."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]/'assets'
im=Image.open(root/'icon.png')
im.save(root/'icon.ico',sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
im.save(root/'icon.icns')
print('Created PNG 1024/2048, ICO and ICNS')
