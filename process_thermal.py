
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject

BASE = Path(__file__).resolve().parent

THERMAL = BASE / "raw" / "themis" / "Gale_crater_THEMIS_nightIR.tif"
ELEVATION = BASE / "processed" / "elevation_5m.tif"
OUTPUT = BASE / "processed" / "thermal_5m.tif"

print("Opening THEMIS Night IR data...")

with rasterio.open(ELEVATION) as dem:
    target_crs = dem.crs
    target_transform = dem.transform
    width = dem.width
    height = dem.height

with rasterio.open(THERMAL) as src:
    print("Original thermal resolution:", src.res)
    print("Original thermal NoData:", src.nodata)
    print("Target grid:", width, "x", height)

    # Use float32 to preserve values and a separate NoData marker.
    thermal = np.full(
        (height, width),
        -9999.0,
        dtype=np.float32
    )

    print("Aligning THEMIS to the elevation grid...")

    reproject(
        source=rasterio.band(src, 1),
        destination=thermal,
        src_transform=src.transform,
        src_crs=src.crs,
        src_nodata=src.nodata,
        dst_transform=target_transform,
        dst_crs=target_crs,
        dst_nodata=-9999.0,
        resampling=Resampling.nearest,
        init_dest_nodata=True
    )

    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": target_crs,
        "transform": target_transform,
        "nodata": -9999.0,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256
    }

    with rasterio.open(OUTPUT, "w", **profile) as dst:
        dst.write(thermal, 1)

valid = thermal != -9999.0

print("\nThermal processing complete!")
print("Saved to:", OUTPUT)
print("Valid thermal pixels:", int(valid.sum()))
print("Total pixels:", thermal.size)

if valid.any():
    print("Minimum thermal intensity:", float(thermal[valid].min()))
    print("Maximum thermal intensity:", float(thermal[valid].max()))
else:
    print("WARNING: No valid thermal pixels!")

with rasterio.open(ELEVATION) as dem:
    with rasterio.open(OUTPUT) as t:
        aligned = (
            dem.width == t.width
            and dem.height == t.height
            and dem.transform == t.transform
            and dem.crs == t.crs
        )
        print("Exact grid alignment:", aligned)
