
"use strict";

// ========================================
// MARS EVA PATHFINDER
// ========================================

const mapWidth = 1364;
const mapHeight = 2707;

const ROUTE_API = "http://127.0.0.1:5000/api/route";
const LANDING_API = "http://127.0.0.1:5000/api/landing";

const bounds = [
    [0, 0],
    [mapHeight, mapWidth]
];

// ========================================
// MAP SETUP
// ========================================

const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 5
});

map.fitBounds(bounds);

L.rectangle(bounds, {
    color: "#a65e3d",
    weight: 2,
    fillColor: "#8b5038",
    fillOpacity: 0.25,
    interactive: false
}).addTo(map);

const photoLayer = L.imageOverlay(
    "images/mars-photo.png",
    bounds
);

const heightLayer = L.imageOverlay(
    "images/mars-height.png",
    bounds
);

const thermalLayer = L.imageOverlay(
    "images/mars-thermal.png",
    bounds
);

let currentLayer = photoLayer;
currentLayer.addTo(map);

function updateStatus(message) {
    document.getElementById("status").textContent = message;
}

function changeLayer(layer, message) {
    map.removeLayer(currentLayer);

    currentLayer = layer;
    currentLayer.addTo(map);

    updateStatus(message);
}

document.getElementById("photoBtn").addEventListener(
    "click",
    () => changeLayer(
        photoLayer,
        "Photo layer selected."
    )
);

document.getElementById("heightBtn").addEventListener(
    "click",
    () => changeLayer(
        heightLayer,
        "Elevation layer selected."
    )
);

document.getElementById("thermalBtn").addEventListener(
    "click",
    () => changeLayer(
        thermalLayer,
        "THEMIS IR layer selected. Contextual imagery only."
    )
);

// ========================================
// MISSION STATE
// ========================================

// Available modes:
// none, start, destination, landing

let mapMode = "none";

let startPoint = null;
let endPoint = null;

let startMarker = null;
let endMarker = null;

let landingMarker = null;
let landingCircle = null;

let routeLines = {};
let routeResults = {};

let selectedRoute = "safest";

let routeRequestInProgress = false;
let landingRequestNumber = 0;

const ROUTE_STYLES = {
    safest: {
        name: "Gentlest Terrain",
        color: "#00ff88"
    },

    fastest: {
        name: "Shortest Safe",
        color: "#27a8ff"
    },

    energy: {
        name: "Lower-Effort Proxy",
        color: "#ff9f32"
    }
};

// ========================================
// HELPER FUNCTIONS
// ========================================

function toGridCoordinates(location) {
    const row = Math.max(
        0,
        Math.min(
            mapHeight - 1,
            Math.floor(mapHeight - location.lat)
        )
    );

    const col = Math.max(
        0,
        Math.min(
            mapWidth - 1,
            Math.floor(location.lng)
        )
    );

    return [row, col];
}

function gridToMap(row, col, gridHeight, gridWidth) {
    const lat =
        (gridHeight - row - 0.5) *
        (mapHeight / gridHeight);

    const lng =
        (col + 0.5) *
        (mapWidth / gridWidth);

    return [lat, lng];
}

function formatCoordinates(location) {
    const [row, col] = toGridCoordinates(location);

    return `Row ${row}, Column ${col}`;
}

function isInsideMap(location) {
    return (
        location.lat >= 0 &&
        location.lat <= mapHeight &&
        location.lng >= 0 &&
        location.lng <= mapWidth
    );
}

function createMissionIcon(color, symbol) {
    return L.divIcon({
        className: "mission-marker",

        html: `
            <div style="
                width:32px;
                height:32px;
                background:${color};
                border:3px solid white;
                border-radius:50%;
                display:flex;
                align-items:center;
                justify-content:center;
                color:white;
                font-weight:bold;
                font-size:14px;
                box-shadow:0 2px 10px #0008;
            ">${symbol}</div>
        `,

        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
}

const startIcon = createMissionIcon("#35b878", "S");
const endIcon = createMissionIcon("#e05252", "D");
const landingIcon = createMissionIcon("#f0b94b", "L");

// ========================================
// BUTTON REFERENCES
// ========================================

const routeSetup =
    document.getElementById("routeSetup");

const startRouteBtn =
    document.getElementById("startRouteBtn");

const selectStartBtn =
    document.getElementById("selectStartBtn");

const selectEndBtn =
    document.getElementById("selectEndBtn");

const routeBtn =
    document.getElementById("routeBtn");

const landingBtn =
    document.getElementById("landingBtn");

// Hide the old selection buttons.
// They are no longer needed.

if (selectStartBtn) {
    selectStartBtn.style.display = "none";
}

if (selectEndBtn) {
    selectEndBtn.style.display = "none";
}

routeSetup.style.display = "none";

// ========================================
// MAP MODES
// ========================================

function setMapMode(mode, message) {
    mapMode = mode;

    startRouteBtn.style.outline = "";
    landingBtn.style.outline = "";

    if (mode === "start" || mode === "destination") {
        startRouteBtn.style.outline =
            "2px solid #f0b94b";
    }

    if (mode === "landing") {
        landingBtn.style.outline =
            "2px solid #f0b94b";
    }

    map.getContainer().style.cursor =
        mode === "none" ? "" : "crosshair";

    if (message) {
        updateStatus(message);
    }
}

// ========================================
// ROUTE COMPARISON PANEL
// ========================================

const routePanel = document.createElement("div");

routePanel.id = "routeComparison";

routePanel.style.cssText = `
    position:absolute;
    right:15px;
    top:15px;
    z-index:1000;
    width:265px;
    max-width:calc(100% - 30px);
    max-height:70vh;
    overflow-y:auto;
    background:rgba(18,25,35,0.94);
    color:white;
    padding:14px;
    border-radius:12px;
    box-shadow:0 4px 20px #0008;
    font-family:Arial,sans-serif;
    font-size:13px;
    display:none;
`;

const mapContainer = document.getElementById("map");

if (getComputedStyle(mapContainer).position === "static") {
    mapContainer.style.position = "relative";
}

mapContainer.appendChild(routePanel);

L.DomEvent.disableClickPropagation(routePanel);
L.DomEvent.disableScrollPropagation(routePanel);

function clearRoutes() {
    Object.values(routeLines).forEach(line => {
        map.removeLayer(line);
    });

    routeLines = {};
    routeResults = {};

    routePanel.innerHTML = "";
    routePanel.style.display = "none";

    document.getElementById("routeDistance").textContent =
        "Not calculated";
}

function selectRoute(routeName) {
    const route = routeResults[routeName];

    if (!route || !routeLines[routeName]) {
        return;
    }

    selectedRoute = routeName;

    Object.entries(routeLines).forEach(([name, line]) => {
        const active = name === routeName;

        line.setStyle({
            weight: active ? 7 : 4,
            opacity: active ? 1 : 0.65
        });

        if (active) {
            line.bringToFront();
        }
    });

    const style = ROUTE_STYLES[routeName];

    document.getElementById("routeDistance").textContent =
        `${route.distance_m} metres`;

    updateStatus(
        `${style.name} | ` +
        `Distance: ${route.distance_m} m | ` +
        `Max slope: ${route.max_slope_deg}° | ` +
        `Time: ${route.estimated_time_min} min`
    );

    renderRouteComparison();
}

function renderRouteComparison() {
    routePanel.innerHTML = "";

    const heading = document.createElement("h3");

    heading.textContent = "MARS EVA ROUTES";
    heading.style.margin = "0 0 10px";

    routePanel.appendChild(heading);

    const subtitle = document.createElement("p");

    subtitle.textContent =
        "Click a route to highlight it.";

    subtitle.style.color = "#b8c5d1";

    routePanel.appendChild(subtitle);

    Object.entries(ROUTE_STYLES).forEach(([name, style]) => {
        const route = routeResults[name];

        const card = document.createElement("button");
        card.type = "button";

        const active = selectedRoute === name;

        card.style.cssText = `
            display:block;
            width:100%;
            text-align:left;
            margin-bottom:9px;
            padding:11px;
            border-radius:8px;
            border:2px solid ${
                active ? style.color : "#45515e"
            };
            background:${
                active ? "#303c49" : "#222c37"
            };
            color:white;
            cursor:${route ? "pointer" : "default"};
            font-family:inherit;
            font-size:12px;
            line-height:1.7;
        `;

        if (!route || !routeLines[name]) {
            card.disabled = true;

            card.textContent =
                `${style.name} — No route found`;
        } else {
            const title = document.createElement("div");

            title.textContent =
                `${active ? "✓ " : ""}${style.name}`;

            title.style.cssText = `
                color:${style.color};
                font-weight:bold;
                font-size:14px;
            `;

            const details = document.createElement("div");

            details.textContent =
                `Distance: ${route.distance_m} m`;

            const time = document.createElement("div");

            time.textContent =
                `Time: ${route.estimated_time_min} min`;

            const slope = document.createElement("div");

            slope.textContent =
                `Maximum slope: ${route.max_slope_deg}°`;

            const ascent = document.createElement("div");

            ascent.textContent =
                `Total ascent: ${route.ascent_m} m`;

            const effort = document.createElement("div");

            effort.textContent =
                `Effort score: ${route.effort_score}`;

            card.append(
                title,
                details,
                time,
                slope,
                ascent,
                effort
            );

            card.addEventListener("click", () => {
                selectRoute(name);
            });
        }

        routePanel.appendChild(card);
    });

    const note = document.createElement("p");

    note.style.cssText =
        "color:#b8c5d1;font-size:11px;line-height:1.5;";

    note.textContent =
        "Routes use a 10° slope restriction. " +
        "Travel time and effort are simplified estimates.";

    routePanel.appendChild(note);

    routePanel.style.display = "block";
}

// ========================================
// START ROUTE BUTTON
// ========================================

startRouteBtn.addEventListener("click", () => {

    // Clear the previous route selection.
    startPoint = null;
    endPoint = null;

    if (startMarker) {
        map.removeLayer(startMarker);
        startMarker = null;
    }

    if (endMarker) {
        map.removeLayer(endMarker);
        endMarker = null;
    }

    clearRoutes();

    document.getElementById("startCoordinates").textContent =
        "Not selected";

    document.getElementById("endCoordinates").textContent =
        "Not selected";

    document.getElementById("coordinates").textContent =
        "Not selected";

    // Show only the Find Route button.
    routeSetup.style.display = "block";

    // Wait for the first map click.
    setMapMode(
        "start",
        "Click the Mars map to select your START location."
    );
});

// ========================================
// LANDING SITE ANALYZER
// ========================================

function updateLandingResult(data) {
    const statusElement =
        document.getElementById("landingStatus");

    statusElement.textContent =
        data.label || "Needs Further Assessment";

    document.getElementById("landingCoordinates").textContent =
        `Row ${data.row}, Column ${data.col}`;

    document.getElementById("landingAvgSlope").textContent =
        data.average_slope_deg == null
            ? "Unavailable"
            : `${data.average_slope_deg}°`;

    document.getElementById("landingMaxSlope").textContent =
        data.max_slope_deg == null
            ? "Unavailable"
            : `${data.max_slope_deg}°`;

    document.getElementById("landingRoughness").textContent =
        data.roughness_m == null
            ? "Unavailable"
            : `${data.roughness_m} m`;

    document.getElementById("landingCoverage").textContent =
        data.coverage_percent == null
            ? "Unavailable"
            : `${data.coverage_percent}%`;

    document.getElementById("landingRadius").textContent =
        data.landing_radius_m == null
            ? "50 metres"
            : `${data.landing_radius_m} metres`;

    document.getElementById("landingReasons").textContent =
        (data.reasons || []).join(" ") ||
        "No additional notes.";

    if (data.status === "passes_screening") {
        statusElement.style.color = "#35b878";
    } else if (data.status === "fails_screening") {
        statusElement.style.color = "#e05252";
    } else {
        statusElement.style.color = "#f0b94b";
    }
}

async function analyzeLandingLocation(location) {
    const [row, col] = toGridCoordinates(location);

    const requestNumber = ++landingRequestNumber;

    updateStatus("Analyzing landing terrain...");

    document.getElementById("landingStatus").textContent =
        "Analyzing...";

    try {
        const response = await fetch(LANDING_API, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({ row, col })
        });

        const data = await response.json();

        if (requestNumber !== landingRequestNumber) {
            return;
        }

        if (!response.ok) {
            throw new Error(
                data.error || "Landing analysis failed."
            );
        }

        updateLandingResult(data);

        if (data.status === "passes_screening") {
            updateStatus(
                "Landing terrain passes preliminary screening."
            );
        } else if (data.status === "fails_screening") {
            updateStatus(
                "Landing terrain fails preliminary screening."
            );
        } else {
            updateStatus(
                "Landing site needs further assessment."
            );
        }

        document.getElementById("landingSection")
            .scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

    } catch (error) {
        if (requestNumber !== landingRequestNumber) {
            return;
        }

        console.error("Landing analysis error:", error);

        document.getElementById("landingStatus").textContent =
            "Analysis error";

        document.getElementById("landingStatus").style.color =
            "#e05252";

        document.getElementById("landingReasons").textContent =
            error.message;

        updateStatus(
            "Landing analysis error: " + error.message
        );
    }
}

function placeLandingSite(location) {
    if (landingMarker) {
        map.removeLayer(landingMarker);
    }

    if (landingCircle) {
        map.removeLayer(landingCircle);
    }

    landingMarker = L.marker(location, {
        icon: landingIcon,
        bubblingMouseEvents: false
    }).addTo(map);

    landingMarker.bindPopup("Selected landing site");

    // 50 metres / 5 metres per pixel = 10 map units.
    landingCircle = L.circle(location, {
        radius: 10,
        color: "#f0b94b",
        fillColor: "#f0b94b",
        fillOpacity: 0.12,
        weight: 2,
        interactive: false
    }).addTo(map);

    setMapMode("none");

    analyzeLandingLocation(location);
}

landingBtn.addEventListener("click", () => {
    setMapMode(
        "landing",
        "Click the Mars map to analyze a landing site."
    );
});

// ========================================
// MAP CLICK HANDLER
// ========================================

map.on("click", event => {
    const location = event.latlng;

    // No tool selected = do nothing.
    if (mapMode === "none") {
        return;
    }

    if (!isInsideMap(location)) {
        updateStatus(
            "Please click inside the Mars map."
        );
        return;
    }

    document.getElementById("coordinates").textContent =
        `Coordinates: ${formatCoordinates(location)}`;

    // FIRST CLICK: START LOCATION
    if (mapMode === "start") {
        startPoint = location;

        if (startMarker) {
            map.removeLayer(startMarker);
        }

        startMarker = L.marker(location, {
            icon: startIcon,
            bubblingMouseEvents: false
        }).addTo(map);

        startMarker.bindPopup("<b>MISSION START</b>");

        document.getElementById("startCoordinates").textContent =
            formatCoordinates(location);

        clearRoutes();

        // Automatically wait for destination.
        setMapMode(
            "destination",
            "Start selected! Click another map location for DESTINATION."
        );

        return;
    }

    // SECOND CLICK: DESTINATION
    if (mapMode === "destination") {
        endPoint = location;

        if (endMarker) {
            map.removeLayer(endMarker);
        }

        endMarker = L.marker(location, {
            icon: endIcon,
            bubblingMouseEvents: false
        }).addTo(map);

        endMarker.bindPopup("<b>MISSION DESTINATION</b>");

        document.getElementById("endCoordinates").textContent =
            formatCoordinates(location);

        clearRoutes();

        // Stop accepting route markers.
        setMapMode(
            "none",
            "Destination selected! Click Find Route."
        );

        return;
    }

    // LANDING SITE SELECTION
    if (mapMode === "landing") {
        placeLandingSite(location);
        return;
    }
});

// ========================================
// FIND ROUTE
// ========================================

routeBtn.addEventListener("click", async () => {
    if (!startPoint || !endPoint) {
        updateStatus(
            "Please click Start Route, then select two map locations."
        );
        return;
    }

    if (routeRequestInProgress) {
        return;
    }

    setMapMode("none");

    routeRequestInProgress = true;
    routeBtn.disabled = true;

    updateStatus(
        "Calculating three Mars EVA routes..."
    );

    try {
        const response = await fetch(ROUTE_API, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                start: toGridCoordinates(startPoint),
                end: toGridCoordinates(endPoint)
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Route calculation failed."
            );
        }

        if (!data.routes) {
            throw new Error(
                "Backend did not return route options."
            );
        }

        if (!data.grid_height || !data.grid_width) {
            throw new Error(
                "Missing route grid dimensions."
            );
        }

        clearRoutes();

        routeResults = data.routes;

        const allPoints = [];

        Object.entries(ROUTE_STYLES).forEach(
            ([name, style]) => {
                const route = routeResults[name];

                if (
                    !route ||
                    !Array.isArray(route.path) ||
                    route.path.length === 0
                ) {
                    return;
                }

                const points = route.path.map(
                    ([row, col]) => gridToMap(
                        row,
                        col,
                        data.grid_height,
                        data.grid_width
                    )
                );

                allPoints.push(...points);

                const line = L.polyline(points, {
                    color: style.color,
                    weight: 4,
                    opacity: 0.75,
                    bubblingMouseEvents: false
                }).addTo(map);

                line.bindPopup(
                    `<b>${style.name}</b><br>` +
                    `Distance: ${route.distance_m} m<br>` +
                    `Max slope: ${route.max_slope_deg}°`
                );

                line.on("click", () => {
                    selectRoute(name);
                });

                routeLines[name] = line;
            }
        );

        if (Object.keys(routeLines).length === 0) {
            throw new Error(
                "No valid routes were returned."
            );
        }

        if (allPoints.length > 1) {
            map.fitBounds(
                L.latLngBounds(allPoints),
                { padding: [40, 40] }
            );
        }

        const firstAvailable = routeLines.safest
            ? "safest"
            : Object.keys(routeLines)[0];

        selectRoute(firstAvailable);

        const count = Object.keys(routeLines).length;

        updateStatus(
            `${count} route option(s) calculated. ` +
            "Select one from the comparison panel."
        );

    } catch (error) {
        console.error("Route error:", error);

        updateStatus(
            "Route error: " + error.message
        );

    } finally {
        routeRequestInProgress = false;
        routeBtn.disabled = false;
    }
});

// ========================================
// RESET
// ========================================

document.getElementById("resetBtn").addEventListener(
    "click",
    () => {
        window.location.reload();
    }
);

// ========================================
// INITIAL STATE
// ========================================

setMapMode(
    "none",
    "Mars map ready. Click Start Route or Analyze Landing Site."
);

console.log("Mars EVA Pathfinder initialized.");
