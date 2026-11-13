
from pathlib import Path
import numpy as np
import rasterio

BASE = Path(__file__).resolve().parent
FOLDER = BASE / "processed"

files = {
    "Elevation": FOLDER / "elevation_5m.tif",
    "Photo": FOLDER / "photo_5m.tif",
    "Thermal": FOLDER / "thermal_5m.tif",
}

print("===== FINAL NASA DATA VALIDATION =====")

with rasterio.open(files["Elevation"]) as dem:
    reference = (
        dem.width,
        dem.height,
        dem.transform,
        dem.crs
    )

    elevation = dem.read(1, masked=True)
    valid_elevation = ~np.ma.getmaskarray(elevation)

for name, path in files.items():
    print(f"\n--- {name} ---")

    with rasterio.open(path) as src:
        matches = (
            src.width,
            src.height,
            src.transform,
            src.crs
        ) == reference

        data = src.read(1, masked=True)
        valid = ~np.ma.getmaskarray(data)

        print("Dimensions:", src.width, "x", src.height)
        print("Resolution:", src.res)
        print("NoData:", src.nodata)
        print("Grid alignment:", matches)
        print("Valid pixels:", int(valid.sum()))

        if name == "Thermal":
            overlap = valid & valid_elevation
            print(
                "Valid thermal + elevation pixels:",
                int(overlap.sum())
            )

        if not matches:
            raise RuntimeError(
                f"{name} does not match the elevation grid!"
            )

print("\nALL GRID ALIGNMENT CHECKS PASSED!")
