# Microscopy Grid Overlay

An interactive, high-performance web application built with Dash and Plotly to align configurable grids over microscopy images, crop specific wells, and compute multi-channel fluorescence intensities.

## Features
- **Upload TIFF/PNG/JPEG**: Native support for high-resolution TIFF images, automatically preserving intrinsic EXIF camera rotations.
- **Dynamic Orthogonal Grid**: Overlay a highly customizable grid on your image. Control the spacing, X/Y offsets, and opacity in real-time.
- **Image Rotation Engine**: Perfectly align skewed microscopy slides by rotating the image underneath the orthogonal grid. Image rotations are fully cached in memory for instantaneous real-time UI feedback.
- **Fluorescence Matrix Analysis**: Calculate pixel intensities across the grid wells. Supports mean grayscale extraction as well as isolated RGB channels and standard Echo fluorophore channels (DAPI, FITC/GFP, TRITC/Texas Red, Cy5, mCherry, CFP, YFP).
- **Interactive Heatmap**: Visualize the computed intensities in a live matrix heatmap.
- **Export Capabilities**:
  - Download the final Grid + Image composite.
  - Crop and download individual wells (e.g. A1, B4).
  - Export the computed fluorescence matrix to CSV.
  - Save your custom grid configurations and reload them instantly.

## Installation

Ensure you have Python 3.7+ installed.

1. Clone this repository:
```bash
git clone https://github.com/zcays/Microscopy-Grid-Overlay.git
cd Microscopy-Grid-Overlay
```

2. Install the required dependencies:
```bash
pip install dash plotly Pillow numpy requests
```

## Running the Application

There are two environments provided:

### Main Application
Run the standard application on port `8050`:
```bash
python microscopy_app.py
```
Open your browser and navigate to `http://127.0.0.1:8050/`.

### Independent Testing Environment
A duplicate testing environment is provided for experimenting with new features or codebase modifications without disrupting your primary workflow:
```bash
python microscopy_app_test.py
```
Open your browser and navigate to `http://127.0.0.1:8051/`.

## Usage Guide
1. **Upload an Image**: Drag and drop your microscopy image (TIFF, PNG, JPEG) into the upload area. 
2. **Align the Grid**: Use the **Image Rotation** slider to orient your slide correctly. Then, use the **Grid Spacing**, **Grid X Offset**, and **Grid Y Offset** sliders to perfectly frame your wells. (Pro tip: Panning is the default interaction mode!)
3. **Compute Fluorescence**: Select a target fluorescent channel from the dropdown and click "Compute Fluorescence". The app will map the intensities of each well into the right-hand Matrix Heatmap.
4. **Export Results**: Click "Export Matrix CSV" to download the numerical data, or "Crop & Download Well" to isolate a specific region for publication.
