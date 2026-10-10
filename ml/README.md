# JAL-SENTINEL Machine Learning & Vision Assets

This directory houses model weights, calibration matrices, and digital elevation datasets:

1. **`yolov8_hazard/`**: YOLOv8 multi-class structural hazard detector (detects open manholes, potholes, live wires, debris, stalled vehicles).
2. **`homography/`**: Camera calibration matrices $\mathbf{H}$ mapping monocular video planes $(u, v)$ to metric ground plane coordinates $(X, Y)$ via physical reference landmarks (e.g. 15 cm kerbs, utility pole benchmarks).
3. **`dem/`**: Digital Elevation Model GeoTIFF rasters (Cartosat-2S / SRTM 30m) covering the Guwahati Bharalu and Mora Bharalu basins for 2D Manning shallow-water inundation flow calculations.
