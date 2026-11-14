
import math

import numpy as np


# ========================================
# MARS LANDING SITE ANALYZER
# Preliminary terrain screening only
# ========================================

PIXEL_SIZE_M = 5.0

# Demonstration assumptions for a crewed lander.
# These are NOT NASA-certified landing requirements.
LANDING_RADIUS_M = 50.0
MAX_AVERAGE_SLOPE_DEG = 5.0
MAX_LOCAL_SLOPE_DEG = 10.0
MAX_ROUGHNESS_M = 1.0

# At least 95% of sampled cells must have valid elevation.
MIN_VALID_COVERAGE = 0.95


def analyze_landing_site(elevation, row, col):
    """
    Analyze a circular 50-metre-radius landing area.

    Uses:
      - Local elevation gradients
      - Average and maximum slope
      - Terrain roughness after removing overall tilt
      - Elevation data coverage

    Returns a preliminary terrain-screening result.
    Does NOT certify landing safety.
    """

    height, width = elevation.shape

    if not (0 <= row < height and 0 <= col < width):
        raise ValueError("Landing point is outside the map.")

    if not np.isfinite(elevation[row, col]):
        raise ValueError("Selected point has invalid elevation.")

    radius_pixels = int(
        math.ceil(LANDING_RADIUS_M / PIXEL_SIZE_M)
    )

    # Include one extra cell around the circular area
    # so slope gradients have neighboring elevation data.
    margin = radius_pixels + 1

    r0 = max(0, row - margin)
    r1 = min(height, row + margin + 1)
    c0 = max(0, col - margin)
    c1 = min(width, col + margin + 1)

    patch = np.asarray(
        elevation[r0:r1, c0:c1],
        dtype=np.float64
    )

    rr, cc = np.indices(patch.shape)

    # Physical coordinates relative to the selected center.
    y = (rr + r0 - row) * PIXEL_SIZE_M
    x = (cc + c0 - col) * PIXEL_SIZE_M

    circle = (
        x ** 2 + y ** 2 <= LANDING_RADIUS_M ** 2
    )

    valid = circle & np.isfinite(patch)

    total_cells = int(np.count_nonzero(circle))
    valid_cells = int(np.count_nonzero(valid))

    coverage = (
        valid_cells / total_cells
        if total_cells > 0 else 0.0
    )

    result = {
        "row": int(row),
        "col": int(col),
        "landing_radius_m": LANDING_RADIUS_M,
        "coverage_percent": round(coverage * 100, 1),
        "average_slope_deg": None,
        "max_slope_deg": None,
        "roughness_m": None,
        "status": "needs_review",
        "label": "Needs Further Assessment",
        "reasons": []
    }

    if coverage < MIN_VALID_COVERAGE:
        result["reasons"].append(
            "Insufficient valid elevation data in the landing area."
        )
        return result

    # Calculate gradients only where all four immediate
    # neighboring cells are valid. This avoids inventing
    # slopes across missing-data gaps.
    interior = (
        (rr > 0) &
        (rr < patch.shape[0] - 1) &
        (cc > 0) &
        (cc < patch.shape[1] - 1)
    )

    slope_mask = valid & interior

    # Work on a NaN-filled array; only accept gradient
    # results whose four neighbors are finite.
    with np.errstate(invalid="ignore"):
        dz_dy, dz_dx = np.gradient(
            patch,
            PIXEL_SIZE_M,
            PIXEL_SIZE_M
        )

        slope_deg = np.degrees(
            np.arctan(
                np.hypot(dz_dx, dz_dy)
            )
        )

    slope_mask &= np.isfinite(slope_deg)

    slope_count = int(np.count_nonzero(slope_mask))

    if slope_count < int(0.95 * total_cells):
        result["reasons"].append(
            "Not enough reliable local slope measurements."
        )
        return result

    average_slope = float(
        np.mean(slope_deg[slope_mask])
    )

    maximum_slope = float(
        np.max(slope_deg[slope_mask])
    )

    # Fit a plane to the landing area to estimate
    # small-scale elevation variation after removing
    # the overall terrain tilt.
    coordinates = np.column_stack((
        x[valid],
        y[valid],
        np.ones(valid_cells)
    ))

    heights = patch[valid]

    coefficients, _, _, _ = np.linalg.lstsq(
        coordinates,
        heights,
        rcond=None
    )

    fitted_plane = coordinates @ coefficients
    residuals = heights - fitted_plane

    roughness = float(
        np.sqrt(np.mean(residuals ** 2))
    )

    result["average_slope_deg"] = round(
        average_slope, 2
    )

    result["max_slope_deg"] = round(
        maximum_slope, 2
    )

    result["roughness_m"] = round(
        roughness, 3
    )

    # ========================================
    # TERRAIN SCREENING DECISION
    # ========================================

    if average_slope > MAX_AVERAGE_SLOPE_DEG:
        result["reasons"].append(
            "Average slope exceeds the demonstration threshold."
        )

    if maximum_slope > MAX_LOCAL_SLOPE_DEG:
        result["reasons"].append(
            "Maximum local slope exceeds the demonstration threshold."
        )

    if roughness > MAX_ROUGHNESS_M:
        result["reasons"].append(
            "Terrain roughness exceeds the demonstration threshold."
        )

    
    # ========================================
    # THREE-LEVEL TERRAIN SUITABILITY RATING
    # Demonstration thresholds only
    # ========================================

    high_concern = (
        average_slope > 8.0
        or maximum_slope > 15.0
        or roughness > 1.5
    )

    moderate_concern = (
        average_slope > 5.0
        or maximum_slope > 10.0
        or roughness > 1.0
    )

    if high_concern:
        result["status"] = "fails_screening"
        result["label"] = "High Terrain Concern"

    elif moderate_concern:
        result["status"] = "moderate_concern"
        result["label"] = "Moderate Terrain Concern"

    else:
        result["status"] = "passes_screening"
        result["label"] = "Low Terrain Concern"
        result["reasons"].append(
            "Terrain meets all preliminary screening thresholds."
        )


    # Surface rocks, soil strength, dust, crater hazards,
    # and landing vehicle dynamics are not evaluated.
    result["limitations"] = [
        "Not a landing safety certification.",
        "Rock and boulder hazards are not evaluated.",
        "Soil bearing strength is unknown.",
        "Small obstacles may be unresolved at 5 m per pixel.",
        "Landing dynamics and atmospheric conditions are not modeled."
    ]

    return result
