"use strict";

// ========================================
// MARS EVA PATHFINDER
// Planner: map, layers, coordinates, routes and landing analysis
// ========================================


// 1. SETTINGS

// Where the Flask server (backend/app.py) is running.
const API_URL = "http://127.0.0.1:5000";

// The map is exactly the size of the elevation grid:
// 1 map unit = 1 pixel = 5 metres.
const mapWidth = 1364;
const mapHeight = 2707;
const PIXEL_SIZE_M = 5;

const bounds = [
    [0, 0],
    [mapHeight, mapWidth]
];

// Where the grid sits on Mars. These numbers come from processed/elevation_5m.tif
// (equirectangular projection, central meridian 137.3° E).
const GEO = {
    left: -3620.0300310055522,      // x of the grid's left edge, metres
    top: -279807.6817621221,        // y of the grid's top edge, metres
    radius: 3396190,                // Mars radius used by the projection, metres
    centralMeridian: 137.3          // degrees east
};

// The three routes the server returns, in the order they are listed.
const ROUTE_STYLES = {
    safest: { name: "Gentlest terrain", colour: "#f3ece4" },
    fastest: { name: "Shortest safe", colour: "#ffc857" },
    energy: { name: "Lower-effort proxy", colour: "#d3a4ff" }
};

const EXTRA_ROUTE_COLOURS = ["#8fe3c8", "#ff9f7a", "#b7c4ff"];

// Colours for the landing analysis result.
const LANDING_COLOURS = {
    passes_screening: "#58d391",
    moderate_concern: "#ffc857",
    fails_screening: "#ff6b5e",
    needs_review: "#a69c92"
};


// 2. CREATE THE MAP

const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: 5,
    zoomSnap: 0.25,
    maxBounds: [[-400, -400], [mapHeight + 400, mapWidth + 400]],
    maxBoundsViscosity: 0.8
});

map.fitBounds(bounds);
map.attributionControl.setPrefix(
    '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>'
);


// 3. MAP LAYERS

const layers = {
    photo: {
        file: "/images/mars-photo-transparent.png",
        button: document.getElementById("photoBtn"),
        note: "HiRISE visible imagery."
    },
    height: {
        file: "/images/mars-height.png",
        button: document.getElementById("heightBtn"),
        note: "HiRISE elevation model on a 5 m grid, with shaded relief."
    },
    thermal: {
        file: "/images/mars-thermal.png",
        button: document.getElementById("thermalBtn"),
        className: "layer-blocks",
        note: "THEMIS Nighttime IR, resampled to the 5 m grid (native about 100 m per pixel). " +
              "Contextual imagery only, not calibrated surface temperature."
    }
};

for (const name of Object.keys(layers)) {
    const layer = layers[name];

    layer.overlay = L.imageOverlay(layer.file, bounds, {
        className: layer.className || ""
    });

    layer.overlay.on("error", function () {
        updateStatus(`Could not load ${layer.file}. Check that it is in frontend/images.`, true);
    });

    layer.button.addEventListener("click", function () {
        changeLayer(name);
    });
}

let currentLayer = null;

function changeLayer(name) {
    if (currentLayer) {
        map.removeLayer(layers[currentLayer].overlay);
    }

    currentLayer = name;
    layers[name].overlay.addTo(map);
    layers[name].overlay.bringToBack();

    for (const key of Object.keys(layers)) {
        layers[key].button.setAttribute("aria-pressed", String(key === name));
    }

    document.getElementById("layerNote").textContent = layers[name].note;
}

// 4. MISSION VARIABLES

let startPoint = null;              // [row, column] on the elevation grid
let endPoint = null;

let startMarker = null;
let endMarker = null;

let sciencePoints = [];
let scienceMarkers = [];

let routes = [];                    // routes currently drawn on the map
let selectedRoute = 0;
let routeRequest = 0;               // lets a newer request replace an older one

let landingMarker = null;
let landingCircle = null;
let landingRequest = 0;

// What the next map click does:
// "auto" (start, then destination), "start", "end", "science" or "landing"
let mapMode = "auto";

let coordinateMode = "grid";        // "grid" (row, column) or "geo" (latitude, longitude)

const routeButton = document.getElementById("routeBtn");

const landingButton = document.getElementById("landingBtn");
const pickStartButton = document.getElementById("pickStartBtn");
const pickEndButton = document.getElementById("pickEndBtn");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;


// 5. STATUS DISPLAY

function updateStatus(message, isProblem = false) {
    const status = document.getElementById("status");
    status.textContent = message;
    status.classList.toggle("is-problem", isProblem);
}

// On wide screens, scrolls the side panel so a new result is in view.
function revealInPanel(id) {
    if (!window.matchMedia("(min-width: 900px)").matches) return;

    document.getElementById(id).scrollIntoView({
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth"
    });
}


// 6. COORDINATES

// Map position -> grid cell [row, column]
function latLngToGrid(latlng) {
    return [
        Math.floor(mapHeight - latlng.lat),
        Math.floor(latlng.lng)
    ];
}

// Grid cell -> map position (the centre of the cell).
// gridWidth / gridHeight allow for a route made on a different grid size.
function gridToLatLng(row, col, gridWidth = mapWidth, gridHeight = mapHeight) {
    return [
        (gridHeight - (row + 0.5)) * (mapHeight / gridHeight),
        (col + 0.5) * (mapWidth / gridWidth)
    ];
}

function insideGrid(point) {
    return point[0] >= 0 && point[0] < mapHeight &&
           point[1] >= 0 && point[1] < mapWidth;
}

// Grid cell -> latitude and longitude on Mars (degrees north, degrees east)
function gridToMars(row, col) {
    const x = GEO.left + (col + 0.5) * PIXEL_SIZE_M;
    const y = GEO.top - (row + 0.5) * PIXEL_SIZE_M;

    return [
        (y / GEO.radius) * (180 / Math.PI),
        GEO.centralMeridian + (x / GEO.radius) * (180 / Math.PI)
    ];
}

// Latitude and longitude on Mars -> grid cell [row, column]
function marsToGrid(latitude, longitude) {
    const y = latitude * (Math.PI / 180) * GEO.radius;
    const x = (longitude - GEO.centralMeridian) * (Math.PI / 180) * GEO.radius;

    return [
        Math.floor((GEO.top - y) / PIXEL_SIZE_M),
        Math.floor((x - GEO.left) / PIXEL_SIZE_M)
    ];
}

function formatGrid(point) {
    return `Row ${point[0]}, Column ${point[1]}`;
}

function formatMars(point) {
    const [latitude, longitude] = gridToMars(point[0], point[1]);
    const hemisphere = latitude < 0 ? "S" : "N";
    return `${Math.abs(latitude).toFixed(5)}° ${hemisphere}, ${longitude.toFixed(5)}° E`;
}

map.on("mousemove", function (event) {
    const point = latLngToGrid(event.latlng);

    document.getElementById("coordinates").textContent = insideGrid(point)
        ? `${formatGrid(point)} · ${formatMars(point)}`
        : "Move over the map to read coordinates";
});


// 7. PINS

function createMissionIcon(kind, symbol) {
    return L.divIcon({
        className: "",
        html: `<div class="pin pin--${kind}">${symbol}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}

const startIcon = createMissionIcon("start", "S");
const endIcon = createMissionIcon("end", "D");
const scienceIcon = createMissionIcon("science", "★");
const landingIcon = createMissionIcon("landing", "L");

function placeMarker(point, icon, label) {
    return L.marker(gridToLatLng(point[0], point[1]), { icon, keyboard: false })
        .addTo(map)
        .bindTooltip(label, { className: "pin-tip", direction: "top", offset: [0, -16] });
}

function setStart(point) {
    clearRoutes();
    startPoint = point;
    if (startMarker) map.removeLayer(startMarker);
    startMarker = placeMarker(point, startIcon, "Start");
    updatePlanPanel();
}

function setEnd(point) {
    clearRoutes();
    endPoint = point;
    if (endMarker) map.removeLayer(endMarker);
    endMarker = placeMarker(point, endIcon, "Destination");
    updatePlanPanel();
}

function nextStepMessage() {
    if (!startPoint) return "Click the map or type coordinates to set the start.";
    if (!endPoint) return "Start set. Click the map or type coordinates to set the destination.";
    return "Start and destination set. Plan the route when you are ready.";
}


// 8. TYPED COORDINATES

const coordinateInputs = {
    start: {
        first: document.getElementById("startFirst"),
        second: document.getElementById("startSecond"),
        error: document.getElementById("startError")
    },
    end: {
        first: document.getElementById("endFirst"),
        second: document.getElementById("endSecond"),
        error: document.getElementById("endError")
    }
};

const [northLatitude, westLongitude] = gridToMars(-0.5, -0.5);
const [southLatitude, eastLongitude] = gridToMars(mapHeight - 0.5, mapWidth - 0.5);

function showPointError(which, message) {
    const error = coordinateInputs[which].error;
    error.textContent = message || "";
    error.hidden = !message;
}

// Shows a point in its two input boxes, in the current coordinate format.
function writePointToInputs(which, point) {
    const inputs = coordinateInputs[which];

    if (!point) {
        inputs.first.value = "";
        inputs.second.value = "";
    } else if (coordinateMode === "grid") {
        inputs.first.value = point[0];
        inputs.second.value = point[1];
    } else {
        const [latitude, longitude] = gridToMars(point[0], point[1]);
        inputs.first.value = latitude.toFixed(5);
        inputs.second.value = longitude.toFixed(5);
    }

    showPointError(which, "");
}

// Reads the two input boxes for a point.
// Returns { point } when valid, { empty: true } when blank, or { error } with a message.
function readPointFromInputs(which) {
    const inputs = coordinateInputs[which];
    const firstText = inputs.first.value.trim();
    const secondText = inputs.second.value.trim();

    if (firstText === "" && secondText === "") return { empty: true };

    if (firstText === "" || secondText === "") {
        return {
            error: coordinateMode === "grid"
                ? "Enter both a row and a column."
                : "Enter both a latitude and a longitude."
        };
    }

    const first = Number(firstText);
    const second = Number(secondText);

    if (!Number.isFinite(first) || !Number.isFinite(second)) {
        return { error: "Use numbers only." };
    }

    if (coordinateMode === "grid") {
        if (!Number.isInteger(first) || !Number.isInteger(second)) {
            return { error: "Row and column must be whole numbers." };
        }
        if (first < 0 || first > mapHeight - 1) {
            return { error: `Row must be between 0 and ${mapHeight - 1}.` };
        }
        if (second < 0 || second > mapWidth - 1) {
            return { error: `Column must be between 0 and ${mapWidth - 1}.` };
        }
        return { point: [first, second] };
    }

    const point = marsToGrid(first, second);

    if (!insideGrid(point)) {
        return {
            error: `That is outside the map. Latitude ${southLatitude.toFixed(4)} to ` +
                   `${northLatitude.toFixed(4)}, longitude ${westLongitude.toFixed(4)} to ` +
                   `${eastLongitude.toFixed(4)}.`
        };
    }

    return { point };
}

// Applies typed coordinates for one point. Returns true if a pin was placed.
function applyTypedPoint(which) {
    const result = readPointFromInputs(which);

    if (result.empty) {
        showPointError(which, "");
        return false;
    }

    if (result.error) {
        showPointError(which, result.error);
        return false;
    }

    const current = which === "start" ? startPoint : endPoint;
    const unchanged = current &&
        current[0] === result.point[0] && current[1] === result.point[1];

    if (!unchanged) {
        if (which === "start") setStart(result.point);
        else setEnd(result.point);

        map.panInside(gridToLatLng(result.point[0], result.point[1]), { padding: [60, 60] });
        updateStatus(nextStepMessage());
    }

    showPointError(which, "");
    return true;
}

for (const which of ["start", "end"]) {
    for (const box of ["first", "second"]) {
        coordinateInputs[which][box].addEventListener("change", function () {
            const other = coordinateInputs[which][box === "first" ? "second" : "first"];

            // Wait until both boxes have something in them.
            if (other.value.trim() !== "") applyTypedPoint(which);
        });
    }
}

document.getElementById("coordinateForm").addEventListener("submit", function (event) {
    event.preventDefault();
    applyTypedPoint("start");
    applyTypedPoint("end");
});

function setCoordinateMode(newMode) {
    coordinateMode = newMode;
    const grid = newMode === "grid";

    document.getElementById("gridModeBtn").setAttribute("aria-pressed", String(grid));
    document.getElementById("geoModeBtn").setAttribute("aria-pressed", String(!grid));

    document.querySelectorAll('[data-coordinate-label="first"]').forEach(function (label) {
        label.textContent = grid ? "Row" : "Latitude °N";
    });
    document.querySelectorAll('[data-coordinate-label="second"]').forEach(function (label) {
        label.textContent = grid ? "Column" : "Longitude °E";
    });

    for (const which of ["start", "end"]) {
        const inputs = coordinateInputs[which];
        inputs.first.step = grid ? "1" : "any";
        inputs.second.step = grid ? "1" : "any";
        inputs.first.placeholder = grid ? `0 to ${mapHeight - 1}` : southLatitude.toFixed(3);
        inputs.second.placeholder = grid ? `0 to ${mapWidth - 1}` : westLongitude.toFixed(3);
    }

    document.getElementById("coordinateRange").textContent = grid
        ? `Rows 0 to ${mapHeight - 1} run north to south. Columns 0 to ${mapWidth - 1} run west to east. Each cell is 5 m.`
        : `South is negative. The map covers latitude ${southLatitude.toFixed(4)} to ` +
          `${northLatitude.toFixed(4)} and longitude ${westLongitude.toFixed(4)} to ${eastLongitude.toFixed(4)}.`;

    writePointToInputs("start", startPoint);
    writePointToInputs("end", endPoint);
}

document.getElementById("gridModeBtn").addEventListener("click", function () {
    setCoordinateMode("grid");
});

document.getElementById("geoModeBtn").addEventListener("click", function () {
    setCoordinateMode("geo");
});


// 9. MAP CLICKS

function updatePlanPanel() {
    writePointToInputs("start", startPoint);
    writePointToInputs("end", endPoint);

    

    routeButton.disabled = !(startPoint && endPoint);
}

// Chooses what the next map click does, and shows which button is waiting.
function setMapMode(newMode) {
    mapMode = newMode;

    const waiting = "Click the map…";

    pickStartButton.textContent = newMode === "start" ? waiting : "Pick on map";
    pickEndButton.textContent = newMode === "end" ? waiting : "Pick on map";
    landingButton.textContent = newMode === "landing" ? waiting : "Analyze a landing site";

    pickStartButton.classList.toggle("is-armed", newMode === "start");
    pickEndButton.classList.toggle("is-armed", newMode === "end");
    landingButton.classList.toggle("is-armed", newMode === "landing");
}

// Each of these buttons switches its mode on, or off again if pressed twice.
function connectModeButton(button, buttonMode, onMessage) {
    button.addEventListener("click", function () {
        const turningOn = mapMode !== buttonMode;
        setMapMode(turningOn ? buttonMode : "auto");
        updateStatus(turningOn ? onMessage : nextStepMessage());
    });
}

connectModeButton(pickStartButton, "start", "Click the map to place the start.");
connectModeButton(pickEndButton, "end", "Click the map to place the destination.");
connectModeButton(landingButton, "landing", "Click the map where the lander would touch down.");

map.on("click", function (event) {
    const point = latLngToGrid(event.latlng);

    if (!insideGrid(point)) {
        updateStatus("That point is outside the mapped terrain.", true);
        return;
    }

    const clickMode = mapMode;
    setMapMode("auto");

    if (clickMode === "landing") {
        analyzeLandingSite(point);
        return;
    }

    // With no tool chosen, the first click is the start and later clicks are the destination.
    if (clickMode === "start" || (clickMode === "auto" && startPoint === null)) {
        setStart(point);
    } else {
        setEnd(point);
    }

    updateStatus(nextStepMessage());
});


// 10. TALKING TO THE SERVER

// Sends JSON to the Flask server and returns its JSON answer.
// Throws an error with .serverMessage when the server explains a problem,
// and with .offline = true when the server cannot be reached at all.
async function postToServer(path, body) {

    // The online preview has no Flask server, so it answers from the browser instead.
    if (window.EVA_PREVIEW_SERVER) {
        return window.EVA_PREVIEW_SERVER(path, body);
    }

    let response;

    try {
        response = await fetch(API_URL + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    } catch (error) {
        error.offline = true;
        throw error;
    }

    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        // The server answered with something that is not JSON.
    }

    if (!response.ok) {
        const problem = new Error("Server error " + response.status);
        problem.serverMessage = data && data.error ? data.error : null;
        throw problem;
    }

    return data;
}


// 11. ROUTES

function pathLength(path) {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
        total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    return total * PIXEL_SIZE_M;
}

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// "lowest_slope" -> "Lowest slope"
function tidyName(key) {
    const words = String(key).replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// Joins the legs of one route (start -> science targets -> destination) into one.
// Returns null if any leg has no route.
function joinLegs(legs) {
    if (legs.some((leg) => !leg || !Array.isArray(leg.path) || leg.path.length === 0)) {
        return null;
    }

    const joined = {
        path: [],
        distance_m: 0,
        ascent_m: 0,
        descent_m: 0,
        estimated_time_min: 0,
        effort_score: 0,
        max_slope_deg: 0,
        avg_slope_deg: 0,
        elevation_profile: []
    };

    let steps = 0;
    let slopeTotal = 0;
    const complete = { ascent_m: true, descent_m: true, estimated_time_min: true, effort_score: true, max_slope_deg: true, avg_slope_deg: true, elevation_profile: true };

    legs.forEach(function (leg, index) {
        const skip = index === 0 ? 0 : 1;           // do not repeat the shared point
        const legSteps = Math.max(leg.path.length - 1, 0);

        joined.path = joined.path.concat(leg.path.slice(skip));
        joined.distance_m += numberOrNull(leg.distance_m) ?? pathLength(leg.path);

        for (const key of ["ascent_m", "descent_m", "estimated_time_min", "effort_score"]) {
            if (numberOrNull(leg[key]) === null) complete[key] = false;
            else joined[key] += leg[key];
        }

        if (numberOrNull(leg.max_slope_deg) === null) complete.max_slope_deg = false;
        else joined.max_slope_deg = Math.max(joined.max_slope_deg, leg.max_slope_deg);

        if (numberOrNull(leg.avg_slope_deg) === null) complete.avg_slope_deg = false;
        else slopeTotal += leg.avg_slope_deg * legSteps;

        if (!Array.isArray(leg.elevation_profile) || leg.elevation_profile.length !== leg.path.length) {
            complete.elevation_profile = false;
        } else {
            joined.elevation_profile = joined.elevation_profile.concat(leg.elevation_profile.slice(skip));
        }

        steps += legSteps;
    });

    joined.avg_slope_deg = steps > 0 ? slopeTotal / steps : 0;

    for (const key of Object.keys(complete)) {
        if (!complete[key]) joined[key] = null;
    }

    return joined;
}

function clearRoutes() {
    routeRequest++;                         // ignore any answer still on its way

    for (const route of routes) {
        if (route.casing) map.removeLayer(route.casing);
        if (route.line) map.removeLayer(route.line);
    }

    routes = [];
    selectedRoute = 0;
    document.getElementById("open3DBtn").disabled = true;

    document.getElementById("routeSummary").hidden = true;
    document.getElementById("routeList").innerHTML = "";
    document.getElementById("routeDistance").textContent = "Not calculated";

    for (const id of ["routeMaxSlope", "routeAvgSlope", "routeAscent", "routeEffort"]) {
        document.getElementById(id).textContent = "–";
    }

    setPlanning(false);
}

function setPlanning(active) {
    routeButton.textContent = active ? "Planning…" : "Plan route";
    routeButton.disabled = active || !(startPoint && endPoint);
}

// The route draws itself from start to destination.
function animateRoute(line) {
    const path = line.getElement();
    if (!path || reducedMotion) return;

    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.getBoundingClientRect();               // apply the starting state
    path.classList.add("is-drawing");
    path.style.strokeDashoffset = "0";

    window.setTimeout(function () {
        path.classList.remove("is-drawing");
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
    }, 1400);
}

function formatMetres(value) {
    return `${Math.round(value).toLocaleString("en-GB")} m`;
}

function formatMinutes(minutes) {
    if (minutes === null) return "–";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}

function drawProfile(profile) {
    const holder = document.getElementById("profile");

    if (!profile || profile.length < 2) {
        holder.hidden = true;
        return;
    }

    let low = Infinity, high = -Infinity;
    for (const elevation of profile) {
        low = Math.min(low, elevation);
        high = Math.max(high, elevation);
    }
    const span = Math.max(high - low, 1);

    // Keep the chart light: at most about 300 points.
    const stride = Math.max(1, Math.floor(profile.length / 300));
    const points = [];
    for (let i = 0; i < profile.length; i += stride) {
        const x = (i / (profile.length - 1)) * 300;
        const y = 66 - ((profile[i] - low) / span) * 60;
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const last = 66 - ((profile[profile.length - 1] - low) / span) * 60;
    points.push(`300,${last.toFixed(1)}`);

    document.getElementById("profileChart").innerHTML =
        `<path class="profile__area" d="M0,72 L${points.join(" L")} L300,72 Z"></path>` +
        `<path class="profile__line" d="M${points.join(" L")}"></path>`;

    document.getElementById("profileRange").textContent =
        `${Math.round(low).toLocaleString("en-GB")} m to ${Math.round(high).toLocaleString("en-GB")} m`;

    holder.hidden = false;
}

function selectRoute(index) {
    selectedRoute = index;

    routes.forEach(function (route, i) {
        const chosen = i === index;
        route.casing.setStyle({ weight: chosen ? 8 : 5, opacity: chosen ? 0.85 : 0.55 });
        route.line.setStyle({ weight: chosen ? 4 : 2, opacity: chosen ? 1 : 0.75 });
        route.button.setAttribute("aria-pressed", String(chosen));
    });

    // Draw the chosen route on top of the others.
    routes[index].casing.bringToFront();
    routes[index].line.bringToFront();

    const route = routes[index];

sessionStorage.setItem("evaSelectedRoute", JSON.stringify({
    name: route.routeKey,
    path: route.rawPath,
    gridWidth: route.gridWidth,
    gridHeight: route.gridHeight
}));

document.getElementById("open3DBtn").disabled = false;
    const degrees = (value) => (value === null ? "–" : `${value.toFixed(1)}°`);

    document.getElementById("routeDistance").textContent = formatMetres(route.distance);
    document.getElementById("routeMaxSlope").textContent = degrees(route.maxSlope);
    document.getElementById("routeAvgSlope").textContent = degrees(route.avgSlope);
    document.getElementById("routeAscent").textContent =
        route.ascent === null ? "–" : formatMetres(route.ascent);
    document.getElementById("routeEffort").textContent =
        route.effort === null ? "–" : Math.round(route.effort).toLocaleString("en-GB");

    drawProfile(route.profile);
}

// "found" is a list of { key, data } where data is a joined route, or null for "no route".
function showRoutes(found, gridWidth, gridHeight) {
    const list = document.getElementById("routeList");
    list.innerHTML = "";

    routes = [];
    let extraColour = 0;

    for (const { key, data } of found) {
        const style = ROUTE_STYLES[key] || {
            name: tidyName(key),
            colour: EXTRA_ROUTE_COLOURS[extraColour++ % EXTRA_ROUTE_COLOURS.length]
        };

        // One row per route in the panel
        const button = document.createElement("button");
        button.type = "button";
        button.className = "routes__option";

        const swatch = document.createElement("span");
        swatch.className = "routes__swatch";
        swatch.style.background = style.colour;

        const name = document.createElement("span");
        name.className = "routes__name";
        name.textContent = style.name;

        const detail = document.createElement("span");
        detail.className = "routes__detail";

        button.append(swatch, name, detail);
        list.append(button);

        if (!data) {
            detail.textContent = "No route found";
            button.disabled = true;
            continue;
        }

        const route = {
            name: style.name,
            button,
            rawPath: data.path,
            routeKey: key,
            gridWidth, gridHeight,
            latLngs: data.path.map(([row, col]) => gridToLatLng(row, col, gridWidth, gridHeight)),
            distance: data.distance_m,
            time: numberOrNull(data.estimated_time_min),
            maxSlope: numberOrNull(data.max_slope_deg),
            avgSlope: numberOrNull(data.avg_slope_deg),
            ascent: numberOrNull(data.ascent_m),
            effort: numberOrNull(data.effort_score),
            profile: data.elevation_profile
        };

        detail.textContent = formatMetres(route.distance);

        route.casing = L.polyline(route.latLngs, {
            color: "#0a0706", interactive: false, className: "route-line"
        }).addTo(map);

        route.line = L.polyline(route.latLngs, {
            color: style.colour, interactive: false, className: "route-line"
        }).addTo(map);

        const index = routes.length;
        button.addEventListener("click", function () {
            selectRoute(index);
        });

        routes.push(route);
    }

    const everything = L.featureGroup(routes.map((route) => route.line));
    map.fitBounds(everything.getBounds(), { padding: [60, 60], animate: false });

    selectRoute(0);
    routes.forEach(function (route) {
        animateRoute(route.casing);
        animateRoute(route.line);
    });

    document.getElementById("routeSummary").hidden = false;
    revealInPanel("routeSummary");
}

// Used only when the server cannot be reached: the test route saved by pathfinding.py.
async function loadSavedRoute() {
    const response = await fetch("route.json?t=" + Date.now());
    if (!response.ok) throw new Error("route.json not found");
    return response.json();
}

routeButton.addEventListener("click", async function () {
    if (!startPoint || !endPoint) return;

    clearRoutes();
    setMapMode("auto");

    const request = routeRequest;
    const stops = [startPoint, endPoint];
    const stopName = (i) =>
        i === 0 ? "the start" : i === stops.length - 1 ? "the destination" : `science target ${i}`;

    setPlanning(true);

    try {
        // One request per leg: start -> each science target in order -> destination.
        const legs = [];
        let gridWidth = mapWidth;
        let gridHeight = mapHeight;

        for (let i = 1; i < stops.length; i++) {
            updateStatus(
                stops.length === 2
                    ? "Calculating three Mars EVA routes…"
                    : `Calculating leg ${i} of ${stops.length - 1}…`
            );

            let data;
            try {
                data = await postToServer("/api/route", { start: stops[i - 1], end: stops[i] });
            } catch (error) {
                error.leg = `from ${stopName(i - 1)} to ${stopName(i)}`;
                throw error;
            }

            if (request !== routeRequest) return;       // the plan changed while we waited

            legs.push(data.routes || {});
            gridWidth = data.grid_width || gridWidth;
            gridHeight = data.grid_height || gridHeight;
        }

        // Join the legs of each route type.
        const keys = [...new Set([
            ...Object.keys(ROUTE_STYLES).filter((key) => legs.some((leg) => key in leg)),
            ...legs.flatMap((leg) => Object.keys(leg))
        ])];

        const found = keys.map((key) => ({
            key,
            data: joinLegs(legs.map((leg) => leg[key]))
        }));

        const count = found.filter((route) => route.data).length;

        if (count === 0) {
            updateStatus(
                "No route passes through every stop under the 10° slope limit. " +
                "Move a pin and plan again.",
                true
            );
            return;
        }

        showRoutes(found, gridWidth, gridHeight);
        updateStatus(
            count === 1
                ? "1 route calculated."
                : `${count} routes calculated. Pick one in the list to highlight it.`
        );

    } catch (error) {
        if (request !== routeRequest) return;

        if (!error.offline) {
            const where = stops.length > 2 && error.leg ? ` (${error.leg})` : "";
            updateStatus(
                (error.serverMessage || "The server could not plan this route.") + where +
                " Move a pin and plan again.",
                true
            );
            return;
        }

        // The server is not running: fall back to the saved test route.
        try {
            const saved = await loadSavedRoute();
            if (request !== routeRequest) return;

            showRoutes(
                [{ key: "Saved test route", data: joinLegs([saved]) }],
                saved.grid_width || mapWidth,
                saved.grid_height || mapHeight
            );
            updateStatus(
                "Could not reach the route server, so this is the saved test route from " +
                "route.json. Start it with: py backend/app.py",
                true
            );
        } catch (fallbackError) {
            updateStatus(
                "Could not reach the route server. Start it with: py backend/app.py",
                true
            );
        }

    } finally {
        if (request === routeRequest) setPlanning(false);
    }
});


// 12. LANDING SITE ANALYZER

function clearLanding() {
    landingRequest++;
    if (landingMarker) map.removeLayer(landingMarker);
    if (landingCircle) map.removeLayer(landingCircle);
    landingMarker = null;
    landingCircle = null;
    document.getElementById("landingResult").hidden = true;
}

function fillList(id, items) {
    const list = document.getElementById(id);
    list.innerHTML = "";

    for (const text of items || []) {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
    }
}

function formatValue(value, unit, digits) {
    return typeof value === "number" ? `${value.toFixed(digits)}${unit}` : "Unavailable";
}

async function analyzeLandingSite(point) {
    clearLanding();

    const request = landingRequest;
    const centre = gridToLatLng(point[0], point[1]);

    landingMarker = placeMarker(point, landingIcon, "Landing site");

    // 50 metres / 5 metres per pixel = 10 map units.
    landingCircle = L.circle(centre, {
        radius: 50 / PIXEL_SIZE_M,
        color: LANDING_COLOURS.needs_review,
        weight: 2,
        fillColor: LANDING_COLOURS.needs_review,
        fillOpacity: 0.18,
        interactive: false
    }).addTo(map);

    updateStatus("Analyzing landing terrain…");

    let result;

    try {
        result = await postToServer("/api/landing", { row: point[0], col: point[1] });
    } catch (error) {
        if (request !== landingRequest) return;
        clearLanding();
        updateStatus(
            error.offline
                ? "The landing analyzer needs the server. Start it with: py backend/app.py"
                : (error.serverMessage || "Landing analysis failed.") + " Try another point.",
            true
        );
        return;
    }

    if (request !== landingRequest) return;

    const colour = LANDING_COLOURS[result.status] || LANDING_COLOURS.needs_review;
    const radiusMetres = typeof result.landing_radius_m === "number" ? result.landing_radius_m : 50;

    landingCircle.setRadius(radiusMetres / PIXEL_SIZE_M);
    landingCircle.setStyle({ color: colour, fillColor: colour });

    const label = document.getElementById("landingStatus");
    label.textContent = result.label || "Needs Further Assessment";
    label.style.color = colour;

    document.getElementById("landingCoordinates").textContent =
        `${formatGrid(point)} · ${formatMars(point)} · ${Math.round(radiusMetres)} m radius`;

    document.getElementById("landingAvgSlope").textContent = formatValue(result.average_slope_deg, "°", 1);
    document.getElementById("landingMaxSlope").textContent = formatValue(result.max_slope_deg, "°", 1);
    document.getElementById("landingRoughness").textContent = formatValue(result.roughness_m, " m", 2);
    document.getElementById("landingCoverage").textContent = formatValue(result.coverage_percent, "%", 0);

    fillList("landingReasons", result.reasons);
    fillList("landingLimitations", result.limitations);
    document.querySelector(".landing__limits").hidden =
        !(result.limitations && result.limitations.length);

    document.getElementById("landingResult").hidden = false;
    revealInPanel("landingResult");
    map.flyToBounds(landingCircle.getBounds(), { padding: [120, 120], maxZoom: 2, duration: 0.6 });

    updateStatus(
        result.status === "passes_screening"
            ? "Landing terrain passes preliminary screening."
            : result.status === "fails_screening"
                ? "Landing terrain fails preliminary screening."
                : result.status === "moderate_concern"
                    ? "Landing terrain shows moderate concern."
                    : "Landing site needs further assessment."
    );
}


// 13. RESET

document.getElementById("resetBtn").addEventListener("click", function () {
    clearRoutes();
    clearLanding();

    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    scienceMarkers.forEach(function (marker) {
        map.removeLayer(marker);
    });

    startPoint = null;
    endPoint = null;
    startMarker = null;
    endMarker = null;
    sciencePoints = [];
    scienceMarkers = [];

    setMapMode("auto");
    updatePlanPanel();
    map.fitBounds(bounds);

    updateStatus("Plan cleared. " + nextStepMessage());
});


// 14. START

changeLayer("photo");
setCoordinateMode("grid");
setMapMode("auto");
updatePlanPanel();
updateStatus(nextStepMessage());


// Share all calculated routes with 3D, remembering the selected one.
document.getElementById("open3DBtn").addEventListener("click", () => {
    const r = routes[selectedRoute];
    if (!r || !r.rawPath) return;

    const allRoutes = {};

    for (const route of routes) {
        if (!route || !route.rawPath) continue;

        allRoutes[route.routeKey] = {
            path: route.rawPath,
            gridWidth: route.gridWidth,
            gridHeight: route.gridHeight
        };
    }

    sessionStorage.setItem("evaSelectedRoute", JSON.stringify({
        name: r.routeKey,
        path: r.rawPath,
        gridWidth: r.gridWidth,
        gridHeight: r.gridHeight,
        allRoutes: allRoutes
    }));

    window.location.href = "/mars-3d-update/terrain.html";
});

// ========================================
// MISSION BRIEFING NAVIGATION
// ========================================

const generateBriefingBtn = document.getElementById("generateBriefingBtn");
const backToPlannerBtn = document.getElementById("backToPlannerBtn");
const missionBriefingView = document.getElementById("missionBriefingView");
const plannerView = document.querySelector(".planner");

generateBriefingBtn.addEventListener("click", function () {
    if (!routes.length) return;

    plannerView.hidden = true;

    missionBriefingView.hidden = false;
    missionBriefingView.style.display = "block";
    missionBriefingView.style.visibility = "visible";
});

backToPlannerBtn.addEventListener("click", function () {
    missionBriefingView.hidden = true;
    missionBriefingView.style.display = "none";

    plannerView.hidden = false;
    map.invalidateSize();
});