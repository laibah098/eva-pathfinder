
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

input_folder = Path("processed")
output_folder = Path("frontend/images")
output_folder.mkdir(parents=True, exist_ok=True)


def colourise(values, colour_stops):
    stops = np.linspace(0, 1, len(colour_stops))
    colours = np.array(colour_stops, dtype=np.float32)

    return np.stack([
        np.interp(values, stops, colours[:, channel])
        for channel in range(3)
    ], axis=-1)


def convert_height():
    with rasterio.open(input_folder / "elevation_5m.tif") as src:
        data = src.read(1, masked=True).astype(np.float32)
        valid = ~np.ma.getmaskarray(data)
        values = data.compressed()

        low, high = np.percentile(values, [2, 98])
        normalized = np.clip(
            (data.filled(low) - low) / (high - low), 0, 1
        )

        # Mars elevation colour palette
        palette = [
            (25, 55, 100),
            (40, 115, 120),
            (100, 155, 105),
            (180, 145, 95),
            (225, 205, 155),
            (250, 245, 225),
        ]

        rgb = colourise(normalized, palette)

        # Calculate shaded relief using the 5-metre pixel spacing
        elevation = data.filled(float(np.median(values)))
        dy = abs(src.transform.e)
        dx = abs(src.transform.a)

        grad_y, grad_x = np.gradient(elevation, dy, dx)

        slope = np.arctan(np.sqrt(grad_x**2 + grad_y**2))
        aspect = np.arctan2(-grad_x, grad_y)

        azimuth = np.radians(315)
        altitude = np.radians(45)

        hillshade = (
            np.sin(altitude) * np.sin(slope)
            + np.cos(altitude) * np.cos(slope)
            * np.cos(azimuth - aspect)
        )

        hillshade = np.clip(hillshade, 0, 1)

        # Combine terrain colours with light and shadow
        shade = 0.45 + 0.55 * hillshade
        rgb = np.clip(rgb * shade[..., None], 0, 255)

        alpha = valid.astype(np.uint8) * 255
        rgba = np.dstack((rgb.astype(np.uint8), alpha))

        Image.fromarray(rgba).save(
            output_folder / "mars-height.png"
        )

        print("Updated elevation map with hillshade.")


def convert_thermal():
    with rasterio.open(input_folder / "thermal_5m.tif") as src:
        data = src.read(1, masked=True).astype(np.float32)
        valid = ~np.ma.getmaskarray(data)
        values = data.compressed()

        # Histogram equalisation improves contrast
        hist, edges = np.histogram(values, bins=2048)
        cdf = np.cumsum(hist).astype(np.float64)
        cdf /= cdf[-1]

        centres = (edges[:-1] + edges[1:]) / 2

        normalized = np.interp(
            data.filled(float(values.min())),
            centres,
            cdf
        )
        normalized = np.clip(normalized, 0, 1)

        # Thermal colour palette
        palette = [
            (35, 10, 90),
            (45, 65, 170),
            (20, 145, 190),
            (60, 190, 130),
            (230, 190, 50),
            (240, 90, 35),
            (255, 240, 140),
        ]

        rgb = colourise(normalized, palette)

        alpha = valid.astype(np.uint8) * 255
        rgba = np.dstack((rgb.astype(np.uint8), alpha))

        Image.fromarray(rgba).save(
            output_folder / "mars-thermal.png"
        )

        print("Updated thermal map with improved contrast.")


convert_height()
convert_thermal()

print("\nBoth improved map images have been created!")
