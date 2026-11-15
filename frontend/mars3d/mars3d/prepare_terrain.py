
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling

# =========================================
# MARS EVA PATHFINDER
# Convert NASA elevation TIFF to terrain JSON
# =========================================

HERE = Path(__file__).resolve().parent

SOURCE = HERE.parent.parent.parent / "processed" / "elevation_5m.tif"
OUTPUT = HERE / "terrain.json"

# Reduced resolution for smooth browser rendering
TARGET_WIDTH = 256

with rasterio.open(SOURCE) as src:

    target_height = round(
        src.height * TARGET_WIDTH / src.width
    )

    # Read elevation at reduced resolution.
    # Masked pixels represent missing elevation data.
    elevation = src.read(
        1,
        out_shape=(target_height, TARGET_WIDTH),
        resampling=Resampling.bilinear,
        masked=True
    )

    values = elevation.filled(np.nan).astype(np.float32)

    valid = np.isfinite(values)

    if not np.any(valid):
        raise ValueError("No valid elevation values found.")

    minimum = float(np.min(values[valid]))
    maximum = float(np.max(values[valid]))

    # Make the lowest valid point height zero
    relative = values - minimum

    # Missing pixels stay missing in JSON
    heights = [
        [
            round(float(value), 2)
            if np.isfinite(value)
            else None
            for value in row
        ]
        for row in relative
    ]

    terrain_data = {
        "width": TARGET_WIDTH,
        "height": target_height,
        "pixelSizeMeters": 5,
        "sourceWidth": src.width,
        "sourceHeight": src.height,
        "minElevation": minimum,
        "maxElevation": maximum,
        "heights": heights
    }

with open(OUTPUT, "w", encoding="utf-8") as file:
    json.dump(terrain_data, file, separators=(",", ":"))

print("SUCCESS! Real Mars terrain data generated.")
print("Output:", OUTPUT)
print("Grid:", TARGET_WIDTH, "x", target_height)
print("Minimum elevation:", round(minimum, 2), "m")
print("Maximum elevation:", round(maximum, 2), "m")
print("Original elevation TIFF was not modified.")
