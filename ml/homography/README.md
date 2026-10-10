# Homography & Inverse Perspective Mapping (IPM) Calibration

Stores 3x3 homography transformation matrices $\mathbf{H}$ calculated using landmark reference benchmarks:

$$\begin{bmatrix} X \\ Y \\ 1 \end{bmatrix} = \mathbf{H} \begin{bmatrix} u \\ v \\ 1 \end{bmatrix}$$

Used by `backend/workers/cv_pipeline.py` to convert pixel waterline displacement into metric rise rates $\frac{dh}{dt}$ in mm/minute.
