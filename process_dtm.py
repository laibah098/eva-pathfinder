from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import from_origin

BASE = Path(__file__).resolve().parent

INPUT = BASE / "raw" / "hirise_dtm" / (
    "DTEEC_001488_1750_001752_1750_U02.IMG"
)

OUTPUT = BASE / "processed" / "elevation_5m.tif"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

TARGET_RESOLUTION = 5.0
NODATA = -9999.0

print("Opening NASA HiRISE DTM...")

with rasterio.open(INPUT) as src:
    if src.crs is None:
        raise ValueError("DTM has no coordinate system.")

    # Calculate the dimensions of the new grid.
    width = int(np.ceil(
        (src.bounds.right - src.bounds.left)
        / TARGET_RESOLUTION
    ))
    height = int(np.ceil(
        (src.bounds.top - src.bounds.bottom)
        / TARGET_RESOLUTION
    ))

    transform = from_origin(
        src.bounds.left,
        src.bounds.top,
        TARGET_RESOLUTION,
        TARGET_RESOLUTION
    )

    # Initialize output with missing-data values.
    elevation = np.full(
        (height, width),
        NODATA,
        dtype=np.float32
    )

    print("Original size:", src.width, "x", src.height)
    print("New size:", width, "x", height)

    # Average elevation values into the 5-metre grid.
    reproject(
        source=rasterio.band(src, 1),
        destination=elevation,
        src_transform=src.transform,
        src_crs=src.crs,
        src_nodata=src.nodata,
        dst_transform=transform,
        dst_crs=src.crs,
        dst_nodata=NODATA,
        resampling=Resampling.average,
        init_dest_nodata=True
    )

    profile = src.profile.copy()
    profile.update(
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        transform=transform,
        dtype="float32",
        nodata=NODATA,
        compress="deflate",
        tiled=True,
        blockxsize=256,
        blockysize=256
    )

    with rasterio.open(OUTPUT, "w", **profile) as dst:
        dst.write(elevation, 1)

valid = elevation != NODATA

print("\nProcessing complete!")
print("Saved to:", OUTPUT)
print("Width:", width)
print("Height:", height)
print("Resolution: 5 metres/pixel")
print("Valid pixels:", int(valid.sum()))

if valid.any():
    print("Minimum elevation:", float(elevation[valid].min()))
    print("Maximum elevation:", float(elevation[valid].max()))
else:
    print("WARNING: No valid elevation pixels found!")
