
// ========================================
// MARS EVA PATHFINDER
// Main Map Functionality
// ========================================


// 1. MAP SETTINGS

const mapWidth = 1364;
const mapHeight = 2707;

const bounds = [
    [0, 0],
    [mapHeight, mapWidth]
];


// 2. CREATE THE MAP

const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 5
});

map.fitBounds(bounds);


// Add a simple Mars-coloured background

const background = L.rectangle(bounds, {
    color: "#a65e3d",
    weight: 2,
    fillColor: "#8b5038",
    fillOpacity: 0.25
}).addTo(map);


// 3. MAP LAYERS

// These image files will be added later.

const photoLayer = L.imageOverlay("images/mars-photo.png", bounds);
const heightLayer = L.imageOverlay("images/mars-height.png", bounds);
const thermalLayer = L.imageOverlay("images/mars-thermal.png", bounds);


// Show the photo layer by default

let currentLayer = photoLayer;
currentLayer.addTo(map);


// Update status if an image cannot be loaded

[photoLayer, heightLayer, thermalLayer].forEach(layer => {
    layer.on("error", function () {
        updateStatus(
            "Image not found yet. Terrain images will be added later."
        );
    });
});


// 4. MISSION VARIABLES

let startPoint = null;
let endPoint = null;

let startMarker = null;
let endMarker = null;

let scienceMarkers = [];
let routeLine = null;

let selectingScienceTarget = false;


// 5. STATUS DISPLAY

function updateStatus(message) {
    document.getElementById("status").textContent = message;
}


// 6. COORDINATE DISPLAY

function updateCoordinates(latlng) {
    const row = Math.round(mapHeight - latlng.lat);
    const column = Math.round(latlng.lng);

    document.getElementById("coordinates").textContent =
        `Coordinates: Row ${row}, Column ${column}`;
}
// Format coordinates for the mission dashboard
function formatCoordinates(location) {
    const row = Math.round(mapHeight - location.lat);
    const column = Math.round(location.lng);

    return `Row ${row}, Column ${column}`;
}

// 7. MAP CLICK FUNCTION

/* ========================================
   7. MAP CLICK FUNCTION
======================================== */

// Custom marker styles
function createMissionIcon(color, symbol) {
    return L.divIcon({
        className: "mission-marker",
        html: `
            <div style="
                width: 32px;
                height: 32px;
                background: ${color};
                border: 3px solid white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 14px;
                box-shadow: 0 2px 10px #0008;
            ">${symbol}</div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
}

const startIcon = createMissionIcon("#35b878", "S");
const endIcon = createMissionIcon("#e05252", "D");
const scienceIcon = createMissionIcon("#398be0", "★");

map.on("click", function (event) {

    const location = event.latlng;

    updateCoordinates(location);

    // SCIENCE TARGET
    if (selectingScienceTarget) {

        const marker = L.marker(location, {
            icon: scienceIcon
        })
        .addTo(map)
        .bindPopup("<b>Science Target</b><br>Research location");

        scienceMarkers.push(marker);
        document.getElementById("scienceCount").textContent =
    scienceMarkers.length;

        selectingScienceTarget = false;

        updateStatus("Science target added successfully.");

        return;
    }

    // MISSION START
    if (startPoint === null) {

        startPoint = location;
        document.getElementById("startCoordinates").textContent =
    formatCoordinates(location);

        if (startMarker) {
            map.removeLayer(startMarker);
        }

        startMarker = L.marker(location, {
            icon: startIcon
        })
        .addTo(map)
        .bindPopup("<b>MISSION START</b>");

        startMarker.openPopup();

        updateStatus("Start point selected. Click another location for the destination.");

    }

    // MISSION DESTINATION
    else {

        endPoint = location;
        document.getElementById("endCoordinates").textContent =
    formatCoordinates(location);

        if (endMarker) {
            map.removeLayer(endMarker);
        }

        endMarker = L.marker(location, {
            icon: endIcon
        })
        .addTo(map)
        .bindPopup("<b>MISSION DESTINATION</b>");

        endMarker.openPopup();

        updateStatus("Destination selected. You can now create a demo route.");

    }

});


// 8. TERRAIN LAYER BUTTONS

function changeLayer(newLayer) {

    if (currentLayer) {
        map.removeLayer(currentLayer);
    }

    currentLayer = newLayer;

    currentLayer.addTo(map);

}


// Photo button

document.getElementById("photoBtn").addEventListener("click", function () {
    changeLayer(photoLayer);
    updateStatus("Photo layer selected.");
});


// Height button

document.getElementById("heightBtn").addEventListener("click", function () {
    changeLayer(heightLayer);
    updateStatus("Height layer selected.");
});


// Thermal button

document.getElementById("thermalBtn").addEventListener("click", function () {
    changeLayer(thermalLayer);
    updateStatus(
        "THEMIS Nighttime IR — resampled to 5 m grid (native ~100 m/pixel). " +
        "Contextual infrared imagery, not calibrated temperature or a hazard map."
    );
});


// 9. ADD SCIENCE TARGET BUTTON

document.getElementById("targetBtn").addEventListener("click", function () {

    selectingScienceTarget = true;

    updateStatus("Click anywhere on the map to add a science target.");

});


// 10. DEMO ROUTE BUTTON

document.getElementById("routeBtn").addEventListener("click", async function () {

    try {
        const response = await fetch("route.json?t=" + Date.now());

        if (!response.ok) {
            throw new Error("Could not find route.json");
        }

        const data = await response.json();

        if (!data.path || data.path.length < 2) {
            updateStatus("No valid A* route found.");
            return;
        }

        if (!data.grid_width || !data.grid_height) {
            updateStatus("Route file is missing grid dimensions.");
            return;
        }

        const points = data.path.map(([row, col]) => {
            const lat = (data.grid_height - (row + 0.5)) * (mapHeight / data.grid_height);
            const lng = (col + 0.5) * (mapWidth / data.grid_width);

            return [lat, lng];
        });

        if (routeLine) {
            map.removeLayer(routeLine);
        }

        routeLine = L.polyline(points, {
            color: "#00ff88",
            weight: 4
        }).addTo(map);

        map.fitBounds(routeLine.getBounds(), {
            padding: [40, 40]
        });

        document.getElementById("routeDistance").textContent =
            data.distance_m + " metres";

        updateStatus(
            "A* route displayed! Distance: " + data.distance_m +
            " m | Maximum slope: " + data.max_slope_deg + "°"
        );

    } catch (error) {
        console.error(error);
        updateStatus("Could not load route.json. Check that the Python script has been run.");
    }

});

// 11. RESET BUTTON

document.getElementById("resetBtn").addEventListener("click", function () {

    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    if (routeLine) map.removeLayer(routeLine);

    scienceMarkers.forEach(marker => {
        map.removeLayer(marker);
    });

    startPoint = null;
    endPoint = null;

    startMarker = null;
    endMarker = null;

    routeLine = null;
    scienceMarkers = [];
    document.getElementById("routeDistance").textContent =
    "Not calculated";
    document.getElementById("startCoordinates").textContent = "Not selected";
document.getElementById("endCoordinates").textContent = "Not selected";
document.getElementById("scienceCount").textContent = "0";

    
    
    
    

    selectingScienceTarget = false;

    document.getElementById("coordinates").textContent =
        "Coordinates: Not selected";

    map.fitBounds(bounds);

    updateStatus("Map reset. Select a new starting location.");

});


// 12. INITIAL MESSAGE

updateStatus("Mars map ready. Select a starting location.");
