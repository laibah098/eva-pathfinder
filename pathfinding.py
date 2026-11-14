
import heapq
import numpy as np
import rasterio
import json

PIXEL_SIZE_M = 5
MAX_SLOPE_DEGREES = 10


def get_cost(current_node, next_node, height_grid, science_grid, weights):
    """
    Calculate movement cost using real Mars terrain elevation.
    Block movements steeper than the test slope threshold.
    """

    # Calculate physical distance in metres
    distance_pixels = np.hypot(
        next_node[0] - current_node[0],
        next_node[1] - current_node[1]
    )
    distance_m = distance_pixels * PIXEL_SIZE_M

    # Calculate slope using elevation difference
    height_diff = abs(
        float(height_grid[next_node]) - float(height_grid[current_node])
    )

    slope_degrees = np.degrees(
        np.arctan(height_diff / distance_m)
    )

    # Block terrain steeper than 10 degrees
    if slope_degrees > MAX_SLOPE_DEGREES:
        return float("inf")

    slope_penalty = height_diff / distance_m

    # Science grid is currently zero everywhere
    science_value = science_grid[next_node]

    total_cost = (
        weights["terrain"] * slope_penalty
        + weights["distance"] * distance_m
        + weights["science"] * science_value
    )

    return max(0.1, total_cost)


def find_route(start, end, height_grid, science_grid, weights):
    """
    Find a route using A* search.
    Avoid missing elevation data and steep terrain.
    """

    rows, cols = height_grid.shape

    if height_grid.shape != science_grid.shape:
        raise ValueError("Elevation and science grids must match")

    def valid(node):
        r, c = node
        return (
            0 <= r < rows
            and 0 <= c < cols
            and np.isfinite(height_grid[node])
            and height_grid[node] != -9999
        )

    if not valid(start) or not valid(end):
        return []

    open_set = []
    heapq.heappush(open_set, (0, start))

    came_from = {}
    g_score = {start: 0}

    neighbors = [
        (0, 1), (1, 0), (0, -1), (-1, 0),
        (1, 1), (1, -1), (-1, 1), (-1, -1)
    ]

    while open_set:
        current_f, current_node = heapq.heappop(open_set)

        # Ignore outdated queue entries
        heuristic = (
            np.hypot(
                end[0] - current_node[0],
                end[1] - current_node[1]
            )
            * PIXEL_SIZE_M
            * weights["distance"]
        )

        if current_f > g_score[current_node] + heuristic + 1e-9:
            continue

        if current_node == end:
            path = []

            while current_node in came_from:
                path.append(current_node)
                current_node = came_from[current_node]

            path.append(start)
            return path[::-1]

        for dr, dc in neighbors:
            neighbor = (
                current_node[0] + dr,
                current_node[1] + dc
            )

            if not valid(neighbor):
                continue

            movement_cost = get_cost(
                current_node,
                neighbor,
                height_grid,
                science_grid,
                weights
            )

            # Skip slopes exceeding our threshold
            if not np.isfinite(movement_cost):
                continue

            tentative_g_score = (
                g_score[current_node] + movement_cost
            )

            if (
                neighbor not in g_score
                or tentative_g_score < g_score[neighbor]
            ):
                came_from[neighbor] = current_node
                g_score[neighbor] = tentative_g_score

                h_score = (
                    np.hypot(
                        end[0] - neighbor[0],
                        end[1] - neighbor[1]
                    )
                    * PIXEL_SIZE_M
                    * weights["distance"]
                )

                f_score = tentative_g_score + h_score

                heapq.heappush(
                    open_set,
                    (f_score, neighbor)
                )

    return []

if __name__ == "__main__":
    # -----------------------------------------
    # LOAD REAL NASA HIRISE ELEVATION DATA
    # -----------------------------------------

    with rasterio.open("processed/elevation_5m.tif") as src:
        elevation = src.read(1).astype(float)

        if src.nodata is not None:
            elevation[elevation == src.nodata] = np.nan

    # Use the valid 100x100 Mars terrain section
    real_heights = elevation[50:150, 700:800]

    # No science bonuses yet
    science_grid = np.zeros(real_heights.shape)

    # Start and end in local pixel coordinates
    test_start = (10, 10)
    test_end = (90, 90)

    test_weights = {
        "terrain": 1.5,
        "distance": 1.0,
        "science": 0.0
    }

    print("Running A* on REAL NASA Mars elevation data...")

    test_path = find_route(
        test_start,
        test_end,
        real_heights,
        science_grid,
        test_weights
    )

    print("Route found:", len(test_path) > 0)
    print("Number of steps:", len(test_path))
    print("Path coordinates:", test_path)

    # -----------------------------------------
    # ANALYZE ROUTE SLOPES
    # -----------------------------------------

    if len(test_path) > 1:
        slopes = []
        total_distance_m = 0

        for a, b in zip(test_path[:-1], test_path[1:]):
            height_difference = abs(
                float(real_heights[b]) - float(real_heights[a])
            )

            distance_m = (
                np.hypot(b[0] - a[0], b[1] - a[1])
                * PIXEL_SIZE_M
            )

            slope_degrees = np.degrees(
                np.arctan(height_difference / distance_m)
            )

            slopes.append(slope_degrees)
            total_distance_m += distance_m

        print("Route distance:", round(total_distance_m, 2), "metres")
        print("Maximum route slope:", round(max(slopes), 2), "degrees")
        print("Average route slope:", round(np.mean(slopes), 2), "degrees")

    else:
        print("No valid route found under the slope limit.")

    # -----------------------------------------
    # EXPORT ROUTE FOR FRONTEND MAP
    # -----------------------------------------

    from pathlib import Path

    if len(test_path) > 1:
        # Convert crop-local coordinates to full raster coordinates
        full_grid_path = [
            [int(row + 50), int(col + 700)]
            for row, col in test_path
        ]

        route_data = {
            "path": full_grid_path,
            "distance_m": round(float(total_distance_m), 2),
            "max_slope_deg": round(float(max(slopes)), 2),
            "avg_slope_deg": round(float(np.mean(slopes)), 2),
            "grid_width": int(elevation.shape[1]),
            "grid_height": int(elevation.shape[0])
        }

        output_path = Path("frontend/route.json")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with output_path.open("w", encoding="utf-8") as f:
            json.dump(route_data, f, indent=2)

        print("Route saved to:", output_path)
    else:
        print("No route to export.")