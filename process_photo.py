
from pathlib import Path
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject

BASE = Path(__file__).resolve().parent

PHOTO = (
    BASE
    / "raw"
    / "hirise_photo"
    / "PSP_001488_1750_RED_C_01_ORTHO.JP2"
)

ELEVATION = BASE / "processed" / "elevation_5m.tif"
OUTPUT = BASE / "processed" / "photo_5m.tif"

print("Opening HiRISE photograph...")

# Read the exact grid definition from our elevation file.
with rasterio.open(ELEVATION) as dem:
    target_crs = dem.crs
    target_transform = dem.transform
    target_width = dem.width
    target_height = dem.height

print("Target grid:", target_width, "x", target_height)

with rasterio.open(PHOTO) as src:
    if src.crs is None:
        raise ValueError("HiRISE photograph has no CRS.")

    # Use a fresh GeoTIFF profile rather than copying
    # the original JPEG2000 block settings.
    profile = {
        "driver": "GTiff",
        "height": target_height,
        "width": target_width,
        "count": 1,
        "dtype": "uint8",
        "crs": target_crs,
        "transform": target_transform,
        "nodata": 0,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }

    print("Aligning photograph to elevation grid...")

    with rasterio.open(OUTPUT, "w", **profile) as dst:
        reproject(
            source=rasterio.band(src, 1),
            destination=rasterio.band(dst, 1),
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata,
            dst_transform=target_transform,
            dst_crs=target_crs,
            dst_nodata=0,
            resampling=Resampling.average,
            init_dest_nodata=True,
        )

print("\nPhotograph processing complete!")
print("Saved to:", OUTPUT)

# Verify alignment with the elevation grid.
with rasterio.open(ELEVATION) as dem:
    with rasterio.open(OUTPUT) as photo:
        aligned = (
            dem.width == photo.width
            and dem.height == photo.height
            and dem.transform == photo.transform
            and dem.crs == photo.crs
        )

        print("Photo dimensions:", photo.width, "x", photo.height)
        print("Resolution:", photo.res)
        print("Exact grid alignment:", aligned)

        if not aligned:
            raise RuntimeError("Photo and elevation grids do not match!")
