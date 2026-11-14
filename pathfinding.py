import numpy as np
import heapq

def get_cost(current_node, next_node, height_grid, science_grid, weights):
    """
    Calculates the movement cost from current_node to next_node.
    Applies the hackathon penalty math: slope, distance, and science value.
    """
    # 1. Calculate physical distance (1 for horizontal/vertical, ~1.414 for diagonal)
    distance = np.sqrt((current_node[0] - next_node[0])**2 + (current_node[1] - next_node[1])**2)
    
    # 2. Calculate Slope Penalty (steepness)
    height_diff = abs(height_grid[next_node] - height_grid[current_node])
    slope_penalty = height_diff / distance
    
    # 3. Assess Science Value (negative cost makes a path more desirable)
    science_value = science_grid[next_node]
    
    # Apply weights
    total_cost = (weights["terrain"] * slope_penalty) + (weights["distance"] * distance) + (weights["science"] * science_value)
    
    return max(0.1, total_cost) # Ensure cost is always slightly positive to prevent infinite loops

def find_route(start, end, height_grid, science_grid, weights):
    """
    Implements the A* search algorithm to find the lowest-cost path.
    """
    rows, cols = height_grid.shape
    open_set = []
    heapq.heappush(open_set, (0, start))
    
    came_from = {}
    g_score = {start: 0}
    
    while open_set:
        current_cost, current_node = heapq.heappop(open_set)
        
        if current_node == end:
            # Reconstruct the path backwards from the end
            path = []
            while current_node in came_from:
                path.append(current_node)
                current_node = came_from[current_node]
            path.append(start)
            return path[::-1] # Reverse it so it goes start to end
            
        # Check all 8 neighboring squares (horizontal, vertical, diagonal)
        neighbors = [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]
        
        for dx, dy in neighbors:
            neighbor = (current_node[0] + dx, current_node[1] + dy)
            
            # Make sure neighbor is inside the map boundaries
            if 0 <= neighbor[0] < rows and 0 <= neighbor[1] < cols:
                movement_cost = get_cost(current_node, neighbor, height_grid, science_grid, weights)
                tentative_g_score = g_score[current_node] + movement_cost
                
                # If we found a cheaper way to get to this neighbor, save it
                if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                    came_from[neighbor] = current_node
                    g_score[neighbor] = tentative_g_score
                    
                    # A* heuristic: distance remaining to the end goal
                    h_score = np.sqrt((end[0] - neighbor[0])**2 + (end[1] - neighbor[1])**2)
                    f_score = tentative_g_score + h_score
                    heapq.heappush(open_set, (f_score, neighbor))
                    
    return [] # Return empty list if no path is found

# Mock data to unblock you immediately
np.random.seed(42) # Set seed so the random grid is the same every time you test
fake_heights = np.random.rand(20, 20) * 50  # 20x20 grid of random elevations
fake_science = np.zeros((20, 20))           # 20x20 grid of science targets
fake_science[10, 10] = 50                   # Add a fake high-value science target in the middle

test_start = (0, 0)
test_end = (19, 19)
test_weights = {"terrain": 1.5, "distance": 1.0, "science": -2.0}

print("Running test route on mock data...")
test_path = find_route(test_start, test_end, fake_heights, fake_science, test_weights)
print(f"Optimal path found! It takes {len(test_path)} steps.")
print("Path coordinates:", test_path)