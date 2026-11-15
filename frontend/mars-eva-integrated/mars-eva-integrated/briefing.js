"use strict";

// ========================================
// MARS EVA PATHFINDER
// Mission briefing: builds the report for a planned route,
// and saves it to the user's device.
//
// Uses the map, pins and routes that script.js keeps.
// ========================================


// 1. ASSUMPTIONS USED IN THE REPORT
// These are demonstration values chosen by the team, not NASA flight rules.

const BRIEFING = {

    // Walking speed used by pathfinding.py for its time estimates.
    walkingSpeedMps: 0.75,

    // The slope limit used by pathfinding.py.
    slopeLimitDeg: 10,

    // Longest walking time, out and back, that the report accepts.
    // (Spacewalks on the International Space Station usually last about 5 to 8 hours.)
    evaTimeLimitHours: 8,

    // Average radiation dose rate measured on the surface at Gale crater by
    // Curiosity's RAD instrument, August 2012 to June 2013 (Hassler et al. 2014).
    radiationMsvPerDay: 0.64,
    radiationUncertaintyMsvPerDay: 0.12,

    // Largest dose from one EVA that the report accepts.
    evaDoseLimitMsv: 1,

    // NASA's career limit for an astronaut (NASA-STD-3001), for comparison.
    careerLimitMsv: 600
};

let currentBriefing = null;         // the briefing now on screen


// 2. SMALL HELPERS

// Builds an HTML element: el("p", { class: "note" }, "text", otherElement)
function el(tag, attributes, ...children) {
    const element = document.createElement(tag);

    for (const [name, value] of Object.entries(attributes || {})) {
        if (value !== null && value !== undefined && value !== false) {
            element.setAttribute(name, value);
        }
    }

    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        element.append(child instanceof Node ? child : String(child));
    }

    return element;
}

// Builds an SVG element the same way.
function svg(tag, attributes, ...children) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);

    for (const [name, value] of Object.entries(attributes || {})) {
        element.setAttribute(name, value);
    }

    for (const child of children.flat()) {
        if (child === null || child === undefined) continue;
        element.append(child instanceof Node ? child : String(child));
    }

    return element;
}

const whole = (value) => Math.round(value).toLocaleString("en-GB");
const fixed = (value, digits) => value.toLocaleString("en-GB", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
});

function formatDuration(minutes) {
    const total = Math.round(minutes);
    if (total < 60) return `${total} min`;
    return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

function formatDose(msv) {
    return msv < 0.1 ? `${fixed(msv * 1000, 0)} µSv` : `${fixed(msv, 2)} mSv`;
}

// A dose with its uncertainty, both in the same unit: "0.14 ± 0.03 mSv"
function formatDoseRange(msv, uncertaintyMsv) {
    return msv < 0.1
        ? `${fixed(msv * 1000, 0)} ± ${fixed(uncertaintyMsv * 1000, 0)} µSv`
        : `${fixed(msv, 2)} ± ${fixed(uncertaintyMsv, 2)} mSv`;
}

function twoDigits(value) {
    return String(value).padStart(2, "0");
}

function describePoint(point) {
    return `${formatGrid(point)} (${formatMars(point)})`;
}


// 3. GATHER THE FACTS FOR ONE ROUTE

function collectBriefing() {
    const originalRoute = routes[selectedRoute];

    // Adapt the current planner's route data for the briefing.
    const route = {
        ...originalRoute,
        path: originalRoute.rawPath,
        colour: ROUTE_STYLES[originalRoute.routeKey]?.colour || "#ffc857",
        descent: null
    };

    const path = route.path;
    const profile = Array.isArray(route.profile) && route.profile.length === path.length
        ? route.profile
        : null;

    // Step-by-step distance, and slope where elevations are available
    const distances = [0];
    const stepSlopes = [];

    for (let i = 1; i < path.length; i++) {
        const run = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) * PIXEL_SIZE_M;
        distances.push(distances[i - 1] + run);

        if (profile) {
            const rise = Math.abs(profile[i] - profile[i - 1]);
            stepSlopes.push({ run, degrees: Math.atan(rise / run) * 180 / Math.PI });
        }
    }

    // How much of the walk falls in each slope band
    let slopeBands = null;

    if (profile) {
        slopeBands = [
            { label: "Under 2°", from: 0, to: 2, metres: 0 },
            { label: "2° to 5°", from: 2, to: 5, metres: 0 },
            { label: "5° to 8°", from: 5, to: 8, metres: 0 },
            { label: "8° to 10°", from: 8, to: Infinity, metres: 0 }
        ];

        for (const step of stepSlopes) {
            const band = slopeBands.find((b) => step.degrees >= b.from && step.degrees < b.to);
            band.metres += step.run;
        }
    }

    const oneWayMinutes = route.time !== null
        ? route.time
        : route.distance / BRIEFING.walkingSpeedMps / 60;
    const roundTripMinutes = oneWayMinutes * 2;
    const roundTripHours = roundTripMinutes / 60;

    const doseMsv = BRIEFING.radiationMsvPerDay * roundTripHours / 24;
    const doseUncertaintyMsv = BRIEFING.radiationUncertaintyMsvPerDay * roundTripHours / 24;

    // The server rounds slopes to two decimals, so allow for that at the limit.
    const slopeKnown = route.maxSlope !== null;
    const slopeOk = !slopeKnown || route.maxSlope <= BRIEFING.slopeLimitDeg + 0.005;
    const timeOk = roundTripHours <= BRIEFING.evaTimeLimitHours;
    const doseOk = doseMsv <= BRIEFING.evaDoseLimitMsv;

    const now = new Date();

    return {
        id: `EVA-${now.getFullYear()}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}-` +
            `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`,
        generated: now,

        route,
        allRoutes: routes.slice(),
        missingRoutes: [],
        path,
        profile,
        distances,
        slopeBands,

        start: startPoint.slice(),
        end: endPoint.slice(),
        stops: sciencePoints.map((point) => point.slice()),
        stopIndexes: route.stopIndexes || [],

        oneWayMinutes,
        roundTripMinutes,
        roundTripHours,
        doseMsv,
        doseUncertaintyMsv,

        slopeKnown,
        slopeOk,
        timeOk,
        doseOk,
        go: slopeOk && timeOk && doseOk,

        landing: null,
        layerName: currentLayer
    };
}


// 4. FIGURES

// A picture of the route on the current map layer.
function drawRouteMap(briefing) {
    const image = layers[briefing.layerName].overlay.getElement();
    if (!image || !image.complete || !image.naturalWidth) return null;

    // The area to show: all routes, with a margin
    let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;

    for (const route of briefing.allRoutes) {
        for (const [row, col] of (route.path || route.rawPath || [])) {
            minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
            minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
        }
    }

    const margin = Math.max(120, 0.12 * Math.max(maxRow - minRow, maxCol - minCol));
    minRow = Math.max(0, Math.floor(minRow - margin));
    maxRow = Math.min(mapHeight, Math.ceil(maxRow + margin));
    minCol = Math.max(0, Math.floor(minCol - margin));
    maxCol = Math.min(mapWidth, Math.ceil(maxCol + margin));

    const cellsWide = maxCol - minCol;
    const cellsHigh = maxRow - minRow;
    const scale = Math.min(1000 / cellsWide, 900 / cellsHigh);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cellsWide * scale);
    canvas.height = Math.round(cellsHigh * scale);

    const context = canvas.getContext("2d");
    context.fillStyle = "#0b0908";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const imageScaleX = image.naturalWidth / mapWidth;
    const imageScaleY = image.naturalHeight / mapHeight;

    try {
        context.imageSmoothingQuality = "high";
        context.drawImage(
            image,
            minCol * imageScaleX, minRow * imageScaleY, cellsWide * imageScaleX, cellsHigh * imageScaleY,
            0, 0, canvas.width, canvas.height
        );
    } catch (error) {
        return null;
    }

    const toX = (col) => (col + 0.5 - minCol) * scale;
    const toY = (row) => (row + 0.5 - minRow) * scale;

    function strokePath(path, colour, lineWidth) {
        context.beginPath();
        (path || []).forEach(([row, col], i) => {
            if (i === 0) context.moveTo(toX(col), toY(row));
            else context.lineTo(toX(col), toY(row));
        });
        context.lineJoin = "round";
        context.lineCap = "round";
        context.strokeStyle = colour;
        context.lineWidth = lineWidth;
        context.stroke();
    }

    // Other routes underneath, the chosen route on top
    for (const route of briefing.allRoutes) {
    if (route.routeKey === briefing.route.routeKey) continue;

    const path = route.path || route.rawPath;
    if (!Array.isArray(path)) continue;

    strokePath(path, "rgba(10, 7, 6, 0.7)", 5);
    strokePath(path, route.colour || "#ff9f43", 2);
}

const selectedPath = briefing.route.path || briefing.route.rawPath;

strokePath(selectedPath, "rgba(10, 7, 6, 0.9)", 9);
strokePath(selectedPath, briefing.route.colour || "#ffc857", 5);

    function pin(point, colour, letter) {
        const x = toX(point[1]), y = toY(point[0]);
        context.beginPath();
        context.arc(x, y, 15, 0, Math.PI * 2);
        context.fillStyle = "#f3ece4";
        context.fill();
        context.beginPath();
        context.arc(x, y, 12, 0, Math.PI * 2);
        context.fillStyle = colour;
        context.fill();
        context.fillStyle = "#0a0706";
        context.font = "bold 14px Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(letter, x, y + 1);
    }

    briefing.stops.forEach((point, i) => pin(point, "#7fb8f5", String(i + 1)));
    pin(briefing.start, "#58d391", "S");
    pin(briefing.end, "#ff6b5e", "D");

    // Scale bar: the largest round length that fits in a fifth of the picture
    const metresAcross = cellsWide * PIXEL_SIZE_M;
    const barMetres = [5000, 2000, 1000, 500, 200, 100, 50].find((m) => m <= metresAcross / 5) || 50;
    const barPixels = barMetres / PIXEL_SIZE_M * scale;
    const barX = 24, barY = canvas.height - 28;

    context.fillStyle = "rgba(10, 7, 6, 0.72)";
    context.fillRect(barX - 12, barY - 28, barPixels + 24, 46);
    context.fillStyle = "#f3ece4";
    context.fillRect(barX, barY, barPixels, 4);
    context.font = "600 14px Arial, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText(barMetres >= 1000 ? `${barMetres / 1000} km` : `${barMetres} m`, barX, barY - 8);

    // North is up
    context.fillStyle = "rgba(10, 7, 6, 0.72)";
    context.fillRect(canvas.width - 58, 14, 44, 50);
    context.fillStyle = "#f3ece4";
    context.beginPath();
    context.moveTo(canvas.width - 36, 22);
    context.lineTo(canvas.width - 28, 40);
    context.lineTo(canvas.width - 44, 40);
    context.closePath();
    context.fill();
    context.textAlign = "center";
    context.fillText("N", canvas.width - 36, 58);

    try {
        return canvas.toDataURL("image/jpeg", 0.86);
    } catch (error) {
        return null;        // the browser would not let the page read the picture
    }
}

// Elevation along the route, as a line chart.
function drawElevationChart(briefing) {
    const { profile, distances } = briefing;
    const width = 720, height = 220;
    const left = 64, right = 16, top = 14, bottom = 40;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;

    let low = Infinity, high = -Infinity;
    for (const elevation of profile) {
        low = Math.min(low, elevation);
        high = Math.max(high, elevation);
    }
    const span = Math.max(high - low, 1);
    const total = distances[distances.length - 1] || 1;

    const x = (metres) => left + (metres / total) * plotWidth;
    const y = (elevation) => top + plotHeight - ((elevation - low) / span) * plotHeight;

    const stride = Math.max(1, Math.floor(profile.length / 500));
    const points = [];
    for (let i = 0; i < profile.length; i += stride) {
        points.push(`${x(distances[i]).toFixed(1)},${y(profile[i]).toFixed(1)}`);
    }
    points.push(`${x(total).toFixed(1)},${y(profile[profile.length - 1]).toFixed(1)}`);

    const chart = svg("svg", {
        class: "chart", viewBox: `0 0 ${width} ${height}`, role: "img",
        "aria-label": `Elevation along the route, from ${whole(low)} m to ${whole(high)} m`
    });

    // Height gridlines
    for (let i = 0; i <= 4; i++) {
        const elevation = low + (span * i) / 4;
        chart.append(
            svg("line", { class: "chart__grid", x1: left, x2: width - right, y1: y(elevation), y2: y(elevation) }),
            svg("text", { class: "chart__label", x: left - 8, y: y(elevation) + 4, "text-anchor": "end" }, `${whole(elevation)} m`)
        );
    }

    // Distance labels
    const step = [5000, 2000, 1000, 500, 200, 100, 50].find((m) => total / m >= 3) || 50;
    for (let metres = 0; metres <= total; metres += step) {
        chart.append(
            svg("text", { class: "chart__label", x: x(metres), y: height - 18, "text-anchor": "middle" },
                metres >= 1000 ? `${fixed(metres / 1000, step < 1000 ? 1 : 0)} km` : `${metres} m`)
        );
    }
    chart.append(svg("text", { class: "chart__label", x: left + plotWidth / 2, y: height - 2, "text-anchor": "middle" }, "Distance from start"));

    chart.append(
        svg("path", {
            class: "chart__area",
            d: `M${left},${top + plotHeight} L${points.join(" L")} L${width - right},${top + plotHeight} Z`
        }),
        svg("path", { class: "chart__line", d: `M${points.join(" L")}` })
    );

    // Science stops along the way
    briefing.stopIndexes.forEach((index, i) => {
        if (index >= profile.length) return;
        chart.append(
            svg("line", { class: "chart__stop", x1: x(distances[index]), x2: x(distances[index]), y1: top, y2: top + plotHeight }),
            svg("text", { class: "chart__label chart__label--stop", x: x(distances[index]) + 5, y: top + 12 }, `Stop ${i + 1}`)
        );
    });

    return chart;
}


// 5. BUILD THE DOCUMENT

function statusChip(ok, textOk = "GO", textNot = "NO-GO") {
    return el("span", { class: `chip ${ok ? "chip--go" : "chip--no"}` }, ok ? textOk : textNot);
}

function figureRow(items) {
    return el("dl", { class: "figures" },
        items.map(([label, value, detail]) =>
            el("div", {},
                el("dt", {}, label),
                el("dd", {}, value),
                detail ? el("p", { class: "figures__detail" }, detail) : null
            )
        )
    );
}

function table(headings, rows, className = "") {
    return el("table", { class: `table ${className}` },
        el("thead", {}, el("tr", {}, headings.map((heading) => el("th", { scope: "col" }, heading)))),
        el("tbody", {}, rows.map((row) =>
            el("tr", { class: row.className || null },
                row.cells.map((cell, i) => el(i === 0 ? "th" : "td", i === 0 ? { scope: "row" } : {}, cell))
            )
        ))
    );
}

function buildBriefingDocument(briefing) {
    const { route } = briefing;
    const degrees = (value) => (value === null ? "Not available" : `${fixed(value, 1)}°`);
    const metres = (value) => (value === null ? "Not available" : `${whole(value)} m`);
    const descent = route.descent;

    const generated = briefing.generated.toLocaleString("en-GB", {
        day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
    });

    const reasons = [];
    if (!briefing.slopeOk) reasons.push("a step is steeper than the slope limit");
    if (!briefing.timeOk) reasons.push(`the walk out and back takes longer than ${BRIEFING.evaTimeLimitHours} hours`);
    if (!briefing.doseOk) reasons.push("the radiation dose is over the single-EVA limit");

    const sheet = el("article", { class: "sheet", id: "briefingDocument" });


    // ---- Header ----

    sheet.append(
        el("header", { class: "sheet__header" },
            el("div", {},
                el("p", { class: "sheet__project" }, "Mars EVA Pathfinder"),
                el("h1", {}, "EVA mission briefing"),
                el("p", { class: "sheet__subtitle" },
                    `${route.name} route, Gale crater study area`)
            ),
            el("div", { class: "sheet__verdict" },
                statusChip(briefing.go),
                el("p", {}, briefing.go
                    ? "All demonstration checks passed."
                    : `Not cleared: ${reasons.join(", and ")}.`)
            )
        ),
        el("dl", { class: "sheet__meta" },
            el("div", {}, el("dt", {}, "Document"), el("dd", {}, briefing.id)),
            el("div", {}, el("dt", {}, "Generated"), el("dd", {}, generated)),
            el("div", {}, el("dt", {}, "Terrain data"), el("dd", {}, "HiRISE elevation model, 5 m grid"))
        ),
        figureRow([
            ["Distance, one way", `${whole(route.distance)} m`],
            ["Walking time, out and back", formatDuration(briefing.roundTripMinutes)],
            ["Steepest step", degrees(route.maxSlope), `Limit ${BRIEFING.slopeLimitDeg}°`],
            ["Radiation dose, out and back", formatDose(briefing.doseMsv)]
        ])
    );


    // ---- 1. Traverse overview ----

    const waypointRows = [
        { cells: ["Start", formatGrid(briefing.start), formatMars(briefing.start), "0 m"] }
    ];

    briefing.stops.forEach((point, i) => {
        const index = briefing.stopIndexes[i];
        waypointRows.push({
            cells: [
                `Science target ${i + 1}`, formatGrid(point), formatMars(point),
                index !== undefined && briefing.distances[index] !== undefined
                    ? `${whole(briefing.distances[index])} m` : "Not available"
            ]
        });
    });

    waypointRows.push({
        cells: ["Destination", formatGrid(briefing.end), formatMars(briefing.end), `${whole(route.distance)} m`]
    });

    const overview = el("section", { class: "sheet__section" },
        el("h2", {}, el("span", { class: "sheet__number" }, "1"), "Traverse overview"),
        el("p", {},
            `The crew walks from the start to the destination along the ${route.name.toLowerCase()} route` +
            (briefing.stops.length
                ? `, stopping at ${briefing.stops.length} science target${briefing.stops.length > 1 ? "s" : ""} on the way`
                : "") +
            ", then returns the same way. Times are walking time only, at " +
            `${BRIEFING.walkingSpeedMps} m/s, with no allowance for work at each stop.`),
        table(["Waypoint", "Grid position", "Latitude and longitude", "Distance from start"], waypointRows),
        figureRow([
            ["Distance, out and back", `${whole(route.distance * 2)} m`],
            ["Walking time, one way", formatDuration(briefing.oneWayMinutes)],
            ["Walking time, out and back", formatDuration(briefing.roundTripMinutes)]
        ])
    );

    const mapPicture = drawRouteMap(briefing);
    if (mapPicture) {
        const others = briefing.allRoutes.filter((r) => r !== route).map((r) => r.name.toLowerCase());
        overview.append(
            el("figure", { class: "sheet__figure" },
                el("img", { src: mapPicture, alt: `Map of the ${route.name.toLowerCase()} route from start to destination` }),
                el("figcaption", {},
                    `The ${route.name.toLowerCase()} route (thick line) on the ${briefing.layerName} layer.` +
                    (others.length ? ` Thin lines show the ${others.join(" and ")} alternatives.` : "") +
                    " North is up.")
            )
        );
    }

    sheet.append(overview);


    // ---- 2. Terrain and hazard analysis ----

    const terrain = el("section", { class: "sheet__section" },
        el("h2", {}, el("span", { class: "sheet__number" }, "2"), "Terrain and hazard analysis")
    );

    const terrainFigures = [
        ["Steepest step", degrees(route.maxSlope), `Limit ${BRIEFING.slopeLimitDeg}°`],
        ["Average slope", degrees(route.avgSlope)],
        ["Climb on the way out", metres(route.ascent)],
        ["Climb on the way back", metres(descent), "The descent on the way out"]
    ];

    if (briefing.profile) {
        const first = briefing.profile[0];
        const last = briefing.profile[briefing.profile.length - 1];
        const change = last - first;
        terrainFigures.push(
            ["Start elevation", `${whole(first)} m`],
            ["Destination elevation", `${whole(last)} m`, `${change >= 0 ? "+" : "-"}${whole(Math.abs(change))} m from start`]
        );
    }

    terrain.append(figureRow(terrainFigures));

    if (briefing.profile) {
        terrain.append(
            el("figure", { class: "sheet__figure" },
                drawElevationChart(briefing),
                el("figcaption", {}, "Elevation along the route, from the HiRISE elevation model.")
            )
        );

        const total = briefing.slopeBands.reduce((sum, band) => sum + band.metres, 0) || 1;
        terrain.append(
            el("h3", {}, "How steep the walk is"),
            el("div", { class: "bands", role: "img", "aria-label": "Share of the route in each slope band" },
                briefing.slopeBands.map((band, i) =>
                    el("div", { class: "bands__row" },
                        el("span", { class: "bands__label" }, band.label),
                        el("span", { class: "bands__track" },
                            el("span", {
                                class: `bands__bar bands__bar--${i + 1}`,
                                style: `width: ${(band.metres / total * 100).toFixed(1)}%`
                            })
                        ),
                        el("span", { class: "bands__value" },
                            `${fixed(band.metres / total * 100, 0)}% · ${whole(band.metres)} m`)
                    )
                )
            )
        );
    }

    const comparisonRows = briefing.allRoutes.map((option) => ({
        className: option === route ? "is-chosen" : null,
        cells: [
            option === route ? `${option.name} (this briefing)` : option.name,
            `${whole(option.distance)} m`,
            option.time === null ? "–" : formatDuration(option.time),
            option.maxSlope === null ? "–" : `${fixed(option.maxSlope, 1)}°`,
            option.avgSlope === null ? "–" : `${fixed(option.avgSlope, 1)}°`,
            option.ascent === null ? "–" : `${whole(option.ascent)} m`,
            option.effort === null ? "–" : whole(option.effort)
        ]
    }));

    for (const name of briefing.missingRoutes) {
        comparisonRows.push({ cells: [name, "No route found", "–", "–", "–", "–", "–"] });
    }

    terrain.append(
        el("h3", {}, "Route options compared"),
        table(["Route", "Distance", "Time, one way", "Steepest step", "Average slope", "Climb", "Effort score"],
            comparisonRows, "table--compact"),
        el("p", { class: "sheet__small" },
            "Effort score is distance plus ten times the climb, a simple stand-in for energy use."),

        el("div", { class: "sheet__columns" },
            el("div", {},
                el("h3", {}, "What the planner checked"),
                el("ul", {},
                    el("li", {}, `Every step between neighbouring 5 m cells rises or falls by no more than ${BRIEFING.slopeLimitDeg}°.`),
                    el("li", {}, "The route never crosses cells that have no elevation data."),
                    briefing.allRoutes.length + briefing.missingRoutes.length === 3
                        ? el("li", {}, "Three searches were run on the same terrain: gentlest terrain, shortest safe, and lower effort.")
                        : null
                )
            ),
            el("div", {},
                el("h3", {}, "What it did not check"),
                el("ul", {},
                    el("li", {}, "Rocks, boulders and other obstacles smaller than the 5 m grid."),
                    el("li", {}, "Loose sand or dust. The thermal layer is shown for context only and is not used in routing."),
                    el("li", {}, "Sideways slope. The ground beside the path can be steeper than the path itself.")
                )
            )
        )
    );

    sheet.append(terrain);


    // ---- 3. Environmental go / no-go ----

    const careerShare = briefing.doseMsv / BRIEFING.careerLimitMsv * 100;

    const checks = [
        {
            cells: [
                "Slope along the route",
                briefing.slopeKnown ? `Steepest step ${fixed(route.maxSlope, 1)}°` : "Enforced by the planner",
                `No more than ${BRIEFING.slopeLimitDeg}°`,
                statusChip(briefing.slopeOk)
            ]
        },
        {
            cells: [
                "Elevation data under the route",
                `All ${whole(briefing.path.length)} points on mapped terrain`,
                "No gaps",
                statusChip(true)
            ]
        },
        {
            cells: [
                "Walking time, out and back",
                formatDuration(briefing.roundTripMinutes),
                `No more than ${BRIEFING.evaTimeLimitHours} h`,
                statusChip(briefing.timeOk)
            ]
        },
        {
            cells: [
                "Radiation dose, out and back",
                formatDoseRange(briefing.doseMsv, briefing.doseUncertaintyMsv),
                `No more than ${BRIEFING.evaDoseLimitMsv} mSv`,
                statusChip(briefing.doseOk)
            ]
        }
    ];

    sheet.append(
        el("section", { class: "sheet__section" },
            el("h2", {}, el("span", { class: "sheet__number" }, "3"), "Environmental go / no-go"),
            table(["Check", "This route", "Threshold", "Status"], checks, "table--checks"),
            el("h3", {}, "Radiation"),
            el("p", {},
                "Curiosity's Radiation Assessment Detector measured an average dose rate of " +
                `${BRIEFING.radiationMsvPerDay} ± ${BRIEFING.radiationUncertaintyMsvPerDay} millisieverts per day ` +
                "on the surface at Gale crater between August 2012 and June 2013. At that rate, " +
                `${formatDuration(briefing.roundTripMinutes)} outside gives about ${formatDose(briefing.doseMsv)}, ` +
                `which is ${careerShare < 0.01 ? "less than 0.01" : fixed(careerShare, 2)}% of NASA's ` +
                `${BRIEFING.careerLimitMsv} mSv career limit for an astronaut.`),
            el("p", { class: "sheet__small" },
                "This is a past average, not a forecast, and a solar particle event can raise the dose rate sharply. " +
                "The thresholds in this table are demonstration values chosen by the project team. " +
                "They are not NASA flight rules.")
        )
    );


    // ---- 4. Science and landing ----

    const science = el("section", { class: "sheet__section" },
        el("h2", {}, el("span", { class: "sheet__number" }, "4"), "Science targets and landing site")
    );

    if (briefing.stops.length) {
        science.append(
            el("p", {},
                `The route passes through ${briefing.stops.length} science target${briefing.stops.length > 1 ? "s" : ""}, ` +
                "in the order they were added to the plan."),
            table(["Target", "Grid position", "Latitude and longitude", "Distance from start"],
                briefing.stops.map((point, i) => {
                    const index = briefing.stopIndexes[i];
                    return {
                        cells: [
                            `Science target ${i + 1}`, formatGrid(point), formatMars(point),
                            index !== undefined && briefing.distances[index] !== undefined
                                ? `${whole(briefing.distances[index])} m` : "Not available"
                        ]
                    };
                }))
        );
    } else {
        science.append(el("p", {}, "No science targets were added to this plan."));
    }

    if (briefing.landing) {
        const result = briefing.landing.result;
        const value = (number, unit, digits) =>
            typeof number === "number" ? `${fixed(number, digits)}${unit}` : "Not available";

        science.append(
            el("h3", {}, "Landing site screening"),
            el("p", {},
                `Screened ${describePoint(briefing.landing.point)}, radius ` +
                `${whole(typeof result.landing_radius_m === "number" ? result.landing_radius_m : 50)} m. Result: `,
                el("strong", {}, result.label || "Needs Further Assessment"), "."),
            figureRow([
                ["Average slope", value(result.average_slope_deg, "°", 1)],
                ["Maximum slope", value(result.max_slope_deg, "°", 1)],
                ["Terrain roughness", value(result.roughness_m, " m", 2)],
                ["Elevation data coverage", value(result.coverage_percent, "%", 0)]
            ]),
            result.reasons && result.reasons.length
                ? el("ul", {}, result.reasons.map((reason) => el("li", {}, reason)))
                : null,
            el("p", { class: "sheet__small" },
                "Preliminary terrain screening only, with demonstration thresholds. It does not certify landing safety.")
        );
    } else {
        science.append(el("p", { class: "sheet__small" },
            "No landing site was analyzed in this session."));
    }

    sheet.append(science);


    // ---- 5. Data sources and limits ----

    sheet.append(
        el("section", { class: "sheet__section" },
            el("h2", {}, el("span", { class: "sheet__number" }, "5"), "Data sources and limits"),
            table(["Data", "Source", "Used for"], [
                { cells: ["Elevation, 5 m grid", "HiRISE digital terrain model, NASA / JPL-Caltech / University of Arizona", "Routes, slopes, climb, landing screening"] },
                { cells: ["Surface imagery", "HiRISE, NASA / JPL-Caltech / University of Arizona", "Map background"] },
                { cells: ["Night infrared", "THEMIS, NASA / JPL-Caltech / Arizona State University", "Map context only"] },
                { cells: ["Radiation dose rate", "MSL Radiation Assessment Detector (Hassler et al., Science, 2014)", "Dose estimate"] }
            ], "table--compact"),
            el("ul", {},
                el("li", {}, `Walking speed is fixed at ${BRIEFING.walkingSpeedMps} m/s on all slopes.`),
                el("li", {}, "The return walk is assumed to follow the same route."),
                el("li", {}, "Suit consumables, communications, lighting and dust are not modelled.")
            )
        ),
        el("footer", { class: "sheet__footer" },
            `${briefing.id}. Produced by Mars EVA Pathfinder, a student hackathon project. ` +
            "This is not an official NASA document and must not be used for real mission planning.")
    );

    return sheet;
}


// 6. SHOW THE BRIEFING

// ========================================
// 6. SHOW THE BRIEFING - CURRENT WEBSITE
// ========================================

function generateBriefing() {
    if (!routes.length) return;

    currentBriefing = collectBriefing();

    const holder = document.getElementById("missionBriefingReport");
    holder.innerHTML = "";
    holder.append(buildBriefingDocument(currentBriefing));

    document.getElementById("briefingTools").hidden = false;
    document.getElementById("briefingNote").textContent =
        `${currentBriefing.id}: ${currentBriefing.route.name} route`;
}


// 7. SAVE TO THE DEVICE

// Hands a file to the browser to download.
async function saveFile(filename, text, type) {

    // The online preview saves files through its viewer instead.
    if (window.EVA_PREVIEW_SAVE) {
        return window.EVA_PREVIEW_SAVE(filename, text);
    }

    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
}

// The report's own styles, read from briefing.css so the saved file looks the same.
function briefingStyles() {
    for (const sheet of document.styleSheets) {
        if (!sheet.href || !sheet.href.split("?")[0].endsWith("briefing.css")) continue;
        try {
            return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
        } catch (error) {
            return "";
        }
    }
    return "";
}

function setToolNote(message, isProblem = false) {
    const note = document.getElementById("briefingNote");
    note.textContent = message;
    note.classList.toggle("is-problem", isProblem);
}

document.getElementById("downloadReportBtn").addEventListener("click", async function () {
    if (!currentBriefing) return;

    const page =
        "<!DOCTYPE html>\n" +
        '<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        `<title>EVA mission briefing ${currentBriefing.id}</title>\n` +
        `<style>\n${briefingStyles()}\n</style>\n</head>\n` +
        '<body class="sheet-page">\n' +
        document.getElementById("briefingDocument").outerHTML +
        "\n</body>\n</html>\n";

    const filename = `${currentBriefing.id}-mission-briefing.html`;

    try {
        await saveFile(filename, page, "text/html");
        setToolNote(`Saved ${filename}. Open it in any browser, or print it to PDF.`);
    } catch (error) {
        setToolNote((error && error.userMessage) || "The report was not saved.", true);
    }
});

document.getElementById("downloadRouteBtn").addEventListener("click", async function () {
    if (!currentBriefing) return;

    const { path, profile, distances } = currentBriefing;
    const lines = ["point,row,column,latitude_deg_north,longitude_deg_east,distance_from_start_m" +
                   (profile ? ",elevation_m" : "")];

    path.forEach(([row, col], i) => {
        const [latitude, longitude] = gridToMars(row, col);
        lines.push(
            [i, row, col, latitude.toFixed(6), longitude.toFixed(6), distances[i].toFixed(1)]
                .concat(profile ? [profile[i]] : [])
                .join(",")
        );
    });

    const filename = `${currentBriefing.id}-route.csv`;

    try {
        await saveFile(filename, lines.join("\n") + "\n", "text/csv");
        setToolNote(`Saved ${filename}.`);
    } catch (error) {
        setToolNote((error && error.userMessage) || "The route data was not saved.", true);
    }
});

document.getElementById("printReportBtn").addEventListener("click", function () {
    window.print();
});

// ========================================
// CONNECT MISSION BRIEFING BUTTON
// ========================================

document.getElementById("generateBriefingBtn")
    .addEventListener("click", generateBriefing);
