
import heapq
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from numba import njit

PIXEL_SIZE_M = 5
MAX_SLOPE_DEGREES = 10

# 8-direction movement
DIRECTIONS = (
    (0, 1), (1, 0), (0, -1), (-1, 0),
    (1, 1), (1, -1), (-1, 1), (-1, -1)
)

# Maximum allowed elevation change per metre
MAX_SLOPE_RATIO = math.tan(math.radians(MAX_SLOPE_DEGREES))


def get_cost(current_node, next_node, height_grid, science_grid, weights):
    """Calculate movement cost and reject slopes over 10 degrees."""
    distance_m = math.hypot(
        next_node[0] - current_node[0],
        next_node[1] - current_node[1]
    ) * PIXEL_SIZE_M

    if distance_m == 0:
        return 0.0

    height_diff = abs(
        float(height_grid[next_node]) -
        float(height_grid[current_node])
    )

    if not math.isfinite(height_diff):
        return float("inf")

    if height_diff > distance_m * MAX_SLOPE_RATIO:
        return float("inf")

    slope_penalty = height_diff / distance_m

    total_cost = (
        weights["terrain"] * slope_penalty
        + weights["distance"] * distance_m
        + weights["science"] * float(science_grid[next_node])
    )

    return max(0.1, total_cost)


@njit(cache=True)
def _fast_astar(
    start_row,
    start_col,
    end_row,
    end_col,
    heights,
    science,
    terrain_weight,
    distance_weight,
    science_weight
):
    """
    Compiled A* using flat arrays and a binary heap.
    Returns a flat array of grid indices for the route.
    """
    rows, cols = heights.shape
    size = rows * cols

    start = start_row * cols + start_col
    goal = end_row * cols + end_col

    g_score = np.full(size, np.inf, dtype=np.float64)
    parent = np.full(size, -1, dtype=np.int32)
    closed = np.zeros(size, dtype=np.uint8)

    # Binary min-heap stored in arrays.
    # A cell can be inserted more than once if its cost improves.
    heap_capacity = max(1024, size // 16)
    heap_nodes = np.empty(heap_capacity, dtype=np.int32)
    heap_scores = np.empty(heap_capacity, dtype=np.float64)
    heap_count = 0

    g_score[start] = 0.0

    start_h = math.hypot(
        end_row - start_row,
        end_col - start_col
    ) * PIXEL_SIZE_M * distance_weight

    # Push start
    heap_nodes[0] = start
    heap_scores[0] = start_h
    heap_count = 1

    drs = np.array((0, 1, 0, -1, 1, 1, -1, -1))
    dcs = np.array((1, 0, -1, 0, 1, -1, 1, -1))

    found = False

    while heap_count > 0:
        # Pop minimum from heap
        current = heap_nodes[0]
        heap_count -= 1

        if heap_count > 0:
            last_node = heap_nodes[heap_count]
            last_score = heap_scores[heap_count]

            pos = 0

            while True:
                left = 2 * pos + 1

                if left >= heap_count:
                    break

                right = left + 1
                child = left

                if (
                    right < heap_count
                    and heap_scores[right] < heap_scores[left]
                ):
                    child = right

                if last_score <= heap_scores[child]:
                    break

                heap_nodes[pos] = heap_nodes[child]
                heap_scores[pos] = heap_scores[child]
                pos = child

            heap_nodes[pos] = last_node
            heap_scores[pos] = last_score

        if closed[current]:
            continue

        if current == goal:
            found = True
            break

        closed[current] = 1

        row = current // cols
        col = current % cols
        current_height = heights[row, col]

        for k in range(8):
            nr = row + drs[k]
            nc = col + dcs[k]

            if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                continue

            neighbor = nr * cols + nc

            if closed[neighbor]:
                continue

            next_height = heights[nr, nc]

            if not math.isfinite(next_height) or next_height == -9999:
                continue

            diagonal = drs[k] != 0 and dcs[k] != 0

            if diagonal:
                distance_m = PIXEL_SIZE_M * math.sqrt(2.0)
            else:
                distance_m = PIXEL_SIZE_M

            height_diff = abs(next_height - current_height)

            if height_diff > distance_m * MAX_SLOPE_RATIO:
                continue

            slope_penalty = height_diff / distance_m

            movement_cost = max(
                0.1,
                terrain_weight * slope_penalty
                + distance_weight * distance_m
                + science_weight * science[nr, nc]
            )

            new_g = g_score[current] + movement_cost

            if new_g >= g_score[neighbor]:
                continue

            g_score[neighbor] = new_g
            parent[neighbor] = current

            heuristic = math.hypot(
                end_row - nr,
                end_col - nc
            ) * PIXEL_SIZE_M * distance_weight

            f_score = new_g + heuristic

            # Grow heap arrays when necessary
            if heap_count >= heap_capacity:
                new_capacity = heap_capacity * 2

                new_nodes = np.empty(new_capacity, dtype=np.int32)
                new_scores = np.empty(new_capacity, dtype=np.float64)

                new_nodes[:heap_count] = heap_nodes[:heap_count]
                new_scores[:heap_count] = heap_scores[:heap_count]

                heap_nodes = new_nodes
                heap_scores = new_scores
                heap_capacity = new_capacity

            # Push into heap
            pos = heap_count
            heap_count += 1

            while pos > 0:
                parent_pos = (pos - 1) // 2

                if heap_scores[parent_pos] <= f_score:
                    break

                heap_nodes[pos] = heap_nodes[parent_pos]
                heap_scores[pos] = heap_scores[parent_pos]
                pos = parent_pos

            heap_nodes[pos] = neighbor
            heap_scores[pos] = f_score

    if not found:
        return np.empty(0, dtype=np.int32)

    # Reconstruct path
    length = 1
    node = goal

    while node != start:
        node = parent[node]
        if node == -1:
            return np.empty(0, dtype=np.int32)
        length += 1

    path = np.empty(length, dtype=np.int32)
    node = goal

    for i in range(length - 1, -1, -1):
        path[i] = node

        if node == start:
            break

        node = parent[node]

    return path


def find_route(start, end, height_grid, science_grid, weights):
    """
    Fast, full-resolution A*.

    Uses the same function signature as the existing Flask backend.
    """
    rows, cols = height_grid.shape

    if height_grid.shape != science_grid.shape:
        raise ValueError("Elevation and science grids must match")

    for row, col in (start, end):
        if not (0 <= row < rows and 0 <= col < cols):
            return []

        height = height_grid[row, col]

        if not np.isfinite(height) or height == -9999:
            return []

    if start == end:
        return [start]

    heights = np.ascontiguousarray(height_grid, dtype=np.float64)
    science = np.ascontiguousarray(science_grid, dtype=np.float32)

    flat_path = _fast_astar(
        int(start[0]),
        int(start[1]),
        int(end[0]),
        int(end[1]),
        heights,
        science,
        float(weights["terrain"]),
        float(weights["distance"]),
        float(weights["science"])
    )

    return [
        (int(index // cols), int(index % cols))
        for index in flat_path
    ]


# ========================================
# MULTI-ROUTE MARS EVA PATHFINDING
# ========================================

ROUTE_PROFILES = {
    "safest": {
        "terrain": 150.0,
        "distance": 1.0,
        "science": 0.0
    },
    "fastest": {
        "terrain": 0.0,
        "distance": 1.0,
        "science": 0.0
    },
    "energy": {
        "terrain": 50.0,
        "distance": 1.0,
        "science": 0.0
    }
}


def find_multiple_routes(start, end, height_grid, science_grid):
    """
    Generate three terrain-aware Mars EVA routes.

    Safest: prioritizes gentler slopes.
    Fastest: shortest distance with a fixed walking speed.
    Energy: distance and slope weighted proxy.

    Every route respects the 10-degree slope threshold.
    """

    routes = {}

    for route_name, weights in ROUTE_PROFILES.items():

        path = find_route(
            start,
            end,
            height_grid,
            science_grid,
            weights
        )

        if not path:
            routes[route_name] = None
            continue

        total_distance = 0.0
        total_ascent = 0.0
        total_descent = 0.0
        slopes = []

        for a, b in zip(path[:-1], path[1:]):

            distance = (
                math.hypot(
                    b[0] - a[0],
                    b[1] - a[1]
                ) * PIXEL_SIZE_M
            )

            elevation_change = (
                float(height_grid[b])
                - float(height_grid[a])
            )

            slope = math.degrees(
                math.atan(abs(elevation_change) / distance)
            )

            total_distance += distance
            slopes.append(slope)

            if elevation_change > 0:
                total_ascent += elevation_change
            else:
                total_descent += abs(elevation_change)

        # Assumed walking speed, not a measured EVA speed
        WALKING_SPEED_MPS = 0.75

        estimated_time_minutes = (
            total_distance / WALKING_SPEED_MPS / 60
        )

        # Preliminary effort proxy, not energy in joules
        effort_score = (
            total_distance + 10.0 * total_ascent
        )

        routes[route_name] = {
            "path": [
                [int(row), int(col)]
                for row, col in path
            ],
            "distance_m": round(total_distance, 2),
            "max_slope_deg": (
                round(max(slopes), 2) if slopes else 0
            ),
            "avg_slope_deg": (
                round(float(np.mean(slopes)), 2)
                if slopes else 0
            ),
            "ascent_m": round(total_ascent, 2),
            "descent_m": round(total_descent, 2),
            "estimated_time_min": round(
                estimated_time_minutes, 1
            ),
            "effort_score": round(effort_score, 2)
        }

    return routes


if __name__ == "__main__":
    # Load the real Mars elevation raster
    with rasterio.open("processed/elevation_5m.tif") as src:
        elevation = src.read(1).astype(float)

        if src.nodata is not None:
            elevation[elevation == src.nodata] = np.nan

    # Test on the same 100 x 100 region as before
    real_heights = elevation[50:150, 700:800]

    science_grid = np.zeros(real_heights.shape, dtype=np.float32)

    test_start = (10, 10)
    test_end = (90, 90)

    test_weights = {
        "terrain": 1.5,
        "distance": 1.0,
        "science": 0.0
    }

    print("Running optimized A* on real Mars elevation data...")

    test_path = find_route(
        test_start,
        test_end,
        real_heights,
        science_grid,
        test_weights
    )

    print("Route found:", len(test_path) > 0)
    print("Number of steps:", len(test_path))

    if len(test_path) > 1:
        slopes = []
        total_distance_m = 0.0

        for a, b in zip(test_path[:-1], test_path[1:]):
            height_difference = abs(
                float(real_heights[b]) -
                float(real_heights[a])
            )

            distance_m = (
                math.hypot(
                    b[0] - a[0],
                    b[1] - a[1]
                ) * PIXEL_SIZE_M
            )

            slope_degrees = math.degrees(
                math.atan(height_difference / distance_m)
            )

            slopes.append(slope_degrees)
            total_distance_m += distance_m

        print(
            "Route distance:",
            round(total_distance_m, 2),
            "metres"
        )
        print(
            "Maximum route slope:",
            round(max(slopes), 2),
            "degrees"
        )
        print(
            "Average route slope:",
            round(float(np.mean(slopes)), 2),
            "degrees"
        )

        full_grid_path = [
            [int(row + 50), int(col + 700)]
            for row, col in test_path
        ]

        route_data = {
            "path": full_grid_path,
            "distance_m": round(total_distance_m, 2),
            "max_slope_deg": round(max(slopes), 2),
            "avg_slope_deg": round(float(np.mean(slopes)), 2),
            "grid_width": int(elevation.shape[1]),
            "grid_height": int(elevation.shape[0])
        }

        output_path = Path("frontend/route.json")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with output_path.open("w", encoding="utf-8") as file:
            json.dump(route_data, file, indent=2)

        print("Route saved to:", output_path)

    else:
        print("No valid route found under the 10-degree slope limit.")
