
from flask import Flask, jsonify, request
from flask_cors import CORS
from pathlib import Path
import sys

import numpy as np
import rasterio

# ========================================
# PROJECT SETUP
# ========================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from pathfinding import find_multiple_routes
from landing_analysis import analyze_landing_site

app = Flask(__name__)
CORS(app)

# ========================================
# LOAD MARS ELEVATION DATA
# ========================================

ELEVATION_PATH = PROJECT_ROOT / "processed" / "elevation_5m.tif"

with rasterio.open(ELEVATION_PATH) as src:
    elevation = src.read(1).astype(float)

    if src.nodata is not None:
        elevation[elevation == src.nodata] = np.nan

science_grid = np.zeros(elevation.shape, dtype=np.float32)

print("Mars elevation data loaded successfully!")
print("Grid size:", elevation.shape)


# ========================================
# BASIC API ROUTES
# ========================================

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Mars EVA Pathfinder API is running!",
        "status": "success"
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})


# ========================================
# THREE EVA ROUTES
# ========================================

@app.route("/api/route", methods=["POST"])
def calculate_route():
    data = request.get_json(silent=True) or {}

    try:
        start_raw = data["start"]
        end_raw = data["end"]

        if (
            not isinstance(start_raw, list)
            or not isinstance(end_raw, list)
            or len(start_raw) != 2
            or len(end_raw) != 2
        ):
            raise ValueError("Invalid coordinates")

        if any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in start_raw + end_raw
        ):
            raise ValueError("Coordinates must be integers")

        start = tuple(start_raw)
        end = tuple(end_raw)

    except (KeyError, TypeError, ValueError):
        return jsonify({
            "error": "Start and end must be [row, column] integer pairs."
        }), 400

    rows, cols = elevation.shape

    for row, col in (start, end):
        if not (0 <= row < rows and 0 <= col < cols):
            return jsonify({
                "error": "Selected point is outside the Mars map."
            }), 400

        if not np.isfinite(elevation[row, col]):
            return jsonify({
                "error": "Selected point has no valid elevation data."
            }), 400

    print("Calculating three Mars EVA routes...")

    routes = find_multiple_routes(
        start,
        end,
        elevation,
        science_grid
    )

    if not any(route is not None for route in routes.values()):
        return jsonify({
            "error": "No route found under the 10-degree slope limit."
        }), 404

    return jsonify({
        "routes": routes,
        "grid_width": int(cols),
        "grid_height": int(rows)
    })


# ========================================
# CREWED MARS LANDING SITE ANALYZER
# ========================================

@app.route("/api/landing", methods=["POST"])
def calculate_landing_safety():
    data = request.get_json(silent=True) or {}

    try:
        row = data["row"]
        col = data["col"]

        if (
            isinstance(row, bool)
            or isinstance(col, bool)
            or not isinstance(row, int)
            or not isinstance(col, int)
        ):
            raise ValueError("Coordinates must be integers.")

        result = analyze_landing_site(
            elevation,
            row,
            col
        )

        return jsonify(result)

    except (KeyError, TypeError, ValueError) as error:
        return jsonify({
            "error": str(error)
        }), 400

    except Exception as error:
        print("Landing analysis error:", error)
        return jsonify({
            "error": "Landing analysis failed."
        }), 500


# ========================================
# RUN FLASK
# ========================================

if __name__ == "__main__":
    app.run(debug=True, port=5000)
