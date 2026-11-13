
from pathlib import Path
import rasterio
from rasterio.warp import transform_bounds

# Project folder
BASE = Path(__file__).resolve().parent

# NASA files
dtm = BASE / "raw" / "hirise_dtm" / "DTEEC_001488_1750_001752_1750_U02.IMG"

photo = BASE / "raw" / "hirise_photo" / "PSP_001488_1750_RED_C_01_ORTHO.JP2"

themis = BASE / "raw" / "themis" / "Gale_crater_THEMIS_nightIR.tif"

files = {
    "HiRISE DTM": dtm,
    "HiRISE Photo": photo,
    "THEMIS Night IR": themis,
}

print("\n===== NASA DATA INSPECTION =====")

for name, path in files.items():
    print(f"\n--- {name} ---")

    if not path.exists():
        print(f"FILE NOT FOUND: {path}")
        continue

    try:
        with rasterio.open(path) as src:
            print("Width:", src.width)
            print("Height:", src.height)
            print("Bands:", src.count)
            print("Pixel resolution:", src.res)
            print("Data type:", src.dtypes)
            print("CRS:", src.crs)
            print("Bounds:", src.bounds)
            print("NoData:", src.nodata)
    except Exception as e:
        print("ERROR:", e)

# Compare geographical coverage in the DTM CRS
print("\n===== COVERAGE CHECK =====")

try:
    with rasterio.open(dtm) as d, rasterio.open(themis) as t:
        if d.crs is None or t.crs is None:
            print("Cannot compare: missing CRS.")
        else:
            print("DTM CRS:", d.crs)
            print("THEMIS CRS:", t.crs)

            bounds = transform_bounds(
                t.crs,
                d.crs,
                *t.bounds,
                densify_pts=101
            )

            print("THEMIS bounds in DTM CRS:", bounds)
            print("DTM bounds:", tuple(d.bounds))

            left = max(d.bounds.left, bounds[0])
            bottom = max(d.bounds.bottom, bounds[1])
            right = min(d.bounds.right, bounds[2])
            top = min(d.bounds.top, bounds[3])

            if left < right and bottom < top:
                print("Bounding boxes overlap: YES")
                print("Overlap width (m):", right - left)
                print("Overlap height (m):", top - bottom)
            else:
                print("Bounding boxes overlap: NO")

            print(
                "Note: Bounding-box overlap does not prove "
                "valid thermal pixels overlap the DTM."
            )

except Exception as e:
    print("COVERAGE CHECK ERROR:", e)

print("\n===== INSPECTION COMPLETE =====")