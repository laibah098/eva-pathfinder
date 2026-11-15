
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// =======================================
// MARS EVA PATHFINDER
// Real NASA 3D terrain explorer
// =======================================

const container = document.getElementById("terrain3d");
const status = document.getElementById("missionStatus");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b12);

const camera = new THREE.PerspectiveCamera(
    55,
    container.clientWidth / container.clientHeight,
    1,
    100000
);

const renderer = new THREE.WebGLRenderer({
    antialias: true
});

renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 1.5));

const sunlight = new THREE.DirectionalLight(0xffffff, 2);
sunlight.position.set(3000, 6000, 3000);
scene.add(sunlight);

let terrainMesh = null;
let terrainWidth = 0;
let terrainDepth = 0;

const textureLoader = new THREE.TextureLoader();

// Our images are in frontend/images/
// Our page is in frontend/mars3d/mars3d/
const imagePaths = {
    photo: "../../images/mars-photo.png",
    height: "../../images/mars-height.png",
    thermal: "../../images/mars-thermal.png"
};

let currentLayer = "photo";

function loadTexture(layer) {
    return new Promise((resolve, reject) => {
        textureLoader.load(
            imagePaths[layer],
            texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = Math.min(
                    8,
                    renderer.capabilities.getMaxAnisotropy()
                );
                resolve(texture);
            },
            undefined,
            reject
        );
    });
}

async function loadRealTerrain() {
    try {
        status.textContent = "Loading real NASA elevation data...";

        const response = await fetch("./terrain.json");

        if (!response.ok) {
            throw new Error(
                `Could not load terrain.json (${response.status})`
            );
        }

        const data = await response.json();

        const cols = data.width;
        const rows = data.height;

        // Each original pixel represents 5 meters
        terrainWidth = data.sourceWidth * data.pixelSizeMeters;
        terrainDepth = data.sourceHeight * data.pixelSizeMeters;

        const geometry = new THREE.PlaneGeometry(
            terrainWidth,
            terrainDepth,
            cols - 1,
            rows - 1
        );

        // A plane starts in XY; rotate it onto the XZ ground plane
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position;

        // Moderate vertical exaggeration makes terrain features visible
        const verticalExaggeration = 2;

        // Record missing pixels so they can be hidden
        const valid = [];

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {

                const index = row * cols + col;
                const height = data.heights[row][col];

                if (height === null) {
                    positions.setY(index, 0);
                    valid.push(false);
                } else {
                    positions.setY(
                        index,
                        height * verticalExaggeration
                    );
                    valid.push(true);
                }
            }
        }

        // Remove triangles containing missing elevation pixels
        const oldIndices = geometry.getIndex().array;
        const filteredIndices = [];

        for (let i = 0; i < oldIndices.length; i += 3) {
            const a = oldIndices[i];
            const b = oldIndices[i + 1];
            const c = oldIndices[i + 2];

            if (valid[a] && valid[b] && valid[c]) {
                filteredIndices.push(a, b, c);
            }
        }

        geometry.setIndex(filteredIndices);
        geometry.computeVertexNormals();

        const photoTexture = await loadTexture("photo");

        const material = new THREE.MeshStandardMaterial({
            map: photoTexture,
            side: THREE.DoubleSide,
            roughness: 1
        });

        terrainMesh = new THREE.Mesh(geometry, material);
        terrainMesh.userData.centerHeight =
    (data.maxElevation - data.minElevation) *
    verticalExaggeration / 2;
        scene.add(terrainMesh);

        // Camera starts above the center of the real terrain
        const centerHeight =
            (data.maxElevation - data.minElevation) *
            verticalExaggeration / 2;

        
camera.position.set(
    terrainWidth * 0.15,
    centerHeight + terrainDepth * 0.55,
    terrainDepth * 0.25
);

controls.target.set(0, centerHeight, 0);

controls.minDistance = 100;
controls.maxDistance = 30000;
controls.maxPolarAngle = Math.PI * 0.48;

controls.update();


        status.textContent =
            "Real Mars terrain loaded! Drag to rotate and zoom.";

    } catch (error) {
        console.error("Mars terrain loading error:", error);

        status.textContent =
            "Error loading terrain. Check browser Console.";
    }
}

async function switchLayer(layer) {
    if (!terrainMesh) return;

    try {
        const texture = await loadTexture(layer);

        const oldTexture = terrainMesh.material.map;

        terrainMesh.material.map = texture;
        terrainMesh.material.needsUpdate = true;

        if (oldTexture) oldTexture.dispose();

        currentLayer = layer;

        document.querySelectorAll(
            "#photoLayerBtn, #heightLayerBtn, #thermalLayerBtn"
        ).forEach(button => button.classList.remove("active"));

        const buttons = {
            photo: "photoLayerBtn",
            height: "heightLayerBtn",
            thermal: "thermalLayerBtn"
        };

        document.getElementById(
            buttons[layer]
        ).classList.add("active");

        status.textContent =
            `${layer.toUpperCase()} layer displayed on 3D terrain.`;

    } catch (error) {
        console.error(error);
        status.textContent = "Could not load selected image.";
    }
}

document.getElementById("photoLayerBtn")
    .addEventListener("click", () => switchLayer("photo"));

document.getElementById("heightLayerBtn")
    .addEventListener("click", () => switchLayer("height"));

document.getElementById("thermalLayerBtn")
    .addEventListener("click", () => switchLayer("thermal"));

document.getElementById("resetCameraBtn")
    .addEventListener("click", () => {

        if (!terrainMesh) return;

        // Stop astronaut flythrough
        astronautPlaying = false;
        astronautLastTime = null;
        astronautProgress = 0;
        astronautPath = [];

        // Enable normal mouse camera controls
        controls.enabled = true;

        const targetHeight =
            terrainMesh.userData.centerHeight || 1500;

        // Restore overhead Mars view
        camera.position.set(
            terrainWidth * 0.15,
            targetHeight + terrainDepth * 0.55,
            terrainDepth * 0.25
        );

        controls.target.set(0, targetHeight, 0);

        controls.update();

        status.textContent =
            "Camera reset to overhead Mars view.";

        routePointStatus.textContent =
            "Camera reset. Ready for another EVA flythrough.";
    });

       

window.addEventListener("resize", () => {
    camera.aspect =
        container.clientWidth / container.clientHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
        container.clientWidth,
        container.clientHeight
    );
});

function animate() {
    requestAnimationFrame(animate);

    if (controls.enabled) {
        controls.update();
    }

    animateAstronaut(performance.now());

    renderer.render(scene, camera);
}
// ==========================================
// 3D MARS — START & DESTINATION SELECTION
// ==========================================

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let selectionMode = null;

let start3D = null;
let end3D = null;

let start3DMarker = null;
let end3DMarker = null;

const routePointStatus =
    document.getElementById("routePointStatus");

// Create a visible marker on the terrain
function create3DMarker(position, color, letter) {

    const group = new THREE.Group();

    // Marker sphere
    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(65, 20, 20),
        new THREE.MeshBasicMaterial({ color })
    );

    sphere.position.y = 80;
    group.add(sphere);

    // Vertical marker pole
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(8, 8, 140, 12),
        new THREE.MeshBasicMaterial({ color })
    );

    pole.position.y = 0;
    group.add(pole);

    // Letter label
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.font = "bold 90px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(letter, 64, 64);

    const labelTexture = new THREE.CanvasTexture(canvas);

    const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: labelTexture,
            transparent: true,
            depthTest: false
        })
    );

    label.scale.set(120, 120, 1);
    label.position.y = 80;

    group.add(label);

    group.position.copy(position);
    group.position.y += 25;

    scene.add(group);

    return group;
}

// Start selection button
document.getElementById("select3DStartBtn")
    .addEventListener("click", () => {

        selectionMode = "start";

        routePointStatus.textContent =
            "Click on the Mars terrain to choose START.";

    });

// Destination selection button
document.getElementById("select3DEndBtn")
    .addEventListener("click", () => {

        selectionMode = "end";

        routePointStatus.textContent =
            "Click on the Mars terrain to choose DESTINATION.";

    });

// Click on 3D terrain
renderer.domElement.addEventListener("click", event => {

    if (!selectionMode || !terrainMesh) return;

    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;

    mouse.y =
        -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersections =
        raycaster.intersectObject(terrainMesh);

    if (intersections.length === 0) {

        routePointStatus.textContent =
            "Click directly on the Mars surface.";

        return;
    }

    const point = intersections[0].point;

    // Convert world position to original raster coordinates
    const col = Math.max(
        0,
        Math.min(
            1363,
            Math.floor(
                ((point.x + terrainWidth / 2) / terrainWidth) *
                1364
            )
        )
    );

    const row = Math.max(
        0,
        Math.min(
            2706,
            Math.floor(
                ((point.z + terrainDepth / 2) / terrainDepth) *
                2707
            )
        )
    );

    if (selectionMode === "start") {

        if (start3DMarker) {
            scene.remove(start3DMarker);
        }

        start3D = [row, col];

        start3DMarker = create3DMarker(
            point,
            0x00ff88,
            "S"
        );

        routePointStatus.textContent =
            `Start: Row ${row}, Column ${col}`;

    } else {

        if (end3DMarker) {
            scene.remove(end3DMarker);
        }

        end3D = [row, col];

        end3DMarker = create3DMarker(
            point,
            0xff4444,
            "D"
        );

        routePointStatus.textContent =
            `Destination: Row ${row}, Column ${col}`;

    }

    selectionMode = null;

});


// ==========================================
// REAL EVA ROUTE CALCULATION
// ==========================================


// ==========================================
// DRAW REAL EVA ROUTES ON 3D MARS
// ==========================================

const evaRouteLines = {};

const EVA_ROUTE_COLORS = {
    safest: 0x00ff88,
    fastest: 0x27a8ff,
    energy: 0xff9f32
};

// Convert backend grid coordinates to 3D coordinates
function routeGridToWorld(row, col, gridHeight, gridWidth) {

    const x =
        ((col + 0.5) / gridWidth - 0.5) *
        terrainWidth;

    const z =
        ((row + 0.5) / gridHeight - 0.5) *
        terrainDepth;

    return { x, z };
}

// Find the actual terrain surface height
function getTerrainSurfaceHeight(x, z) {

    if (!terrainMesh) return null;

    const origin = new THREE.Vector3(
        x,
        terrainMesh.userData.centerHeight +
            terrainDepth * 3,
        z
    );

    const downward = new THREE.Vector3(0, -1, 0);

    const ray = new THREE.Raycaster(origin, downward);

    const hits = ray.intersectObject(terrainMesh);

    return hits.length > 0
        ? hits[0].point.y
        : null;
}

// Remove previous route lines
function clear3DRoutes() {

    Object.values(evaRouteLines).forEach(line => {

        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();

    });

    Object.keys(evaRouteLines).forEach(name => {
        delete evaRouteLines[name];
    });
}

// Draw a single backend route
function drawSingle3DRoute(name, route, gridHeight, gridWidth) {

    if (!route || !Array.isArray(route.path)) {
        return;
    }

    const points = [];

    for (const [row, col] of route.path) {

        const { x, z } = routeGridToWorld(
            row,
            col,
            gridHeight,
            gridWidth
        );

        const surfaceY = getTerrainSurfaceHeight(x, z);

        if (surfaceY === null) {
            continue;
        }

        points.push(
            new THREE.Vector3(
                x,
                surfaceY + 12,
                z
            )
        );
    }

    if (points.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(points);

    const geometry = new THREE.TubeGeometry(
        curve,
        Math.max(points.length * 2, 50),
        12,
        6,
        false
    );

    const material = new THREE.MeshBasicMaterial({
        color: EVA_ROUTE_COLORS[name] || 0xffffff
    });

    const line = new THREE.Mesh(geometry, material);

    scene.add(line);

    evaRouteLines[name] = line;
}

// Draw all available routes
function drawAll3DRoutes() {

    if (!evaRoutes || !evaGridHeight || !evaGridWidth) {
        return;
    }

    clear3DRoutes();

    Object.entries(evaRoutes).forEach(([name, route]) => {

        drawSingle3DRoute(
            name,
            route,
            evaGridHeight,
            evaGridWidth
        );

    });

    console.log("Real EVA routes drawn on 3D Mars.");
}


let evaRoutes = null;
let evaGridWidth = null;
let evaGridHeight = null;

document.getElementById("calculate3DRouteBtn")
    .addEventListener("click", async () => {

        if (!start3D || !end3D) {
            routePointStatus.textContent =
                "Select START and DESTINATION first.";
            return;
        }

        const button =
            document.getElementById("calculate3DRouteBtn");

        button.disabled = true;

        routePointStatus.textContent =
            "Calculating real Mars EVA routes...";

        try {
            const response = await fetch(
                "http://127.0.0.1:5000/api/route",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        start: start3D,
                        end: end3D
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Route calculation failed."
                );
            }

            if (!data.routes) {
                throw new Error(
                    "Backend did not return routes."
                );
            }

            evaRoutes = data.routes;
            evaGridWidth = data.grid_width;
            evaGridHeight = data.grid_height;
            drawAll3DRoutes();

            console.log("3D EVA routes:", evaRoutes);

            const available = Object.entries(evaRoutes)
                .filter(
                    ([name, route]) =>
                        route &&
                        Array.isArray(route.path) &&
                        route.path.length > 0
                );

            if (available.length === 0) {
                routePointStatus.textContent =
                    "No valid routes found between these points.";
                return;
            }

            const summary = available.map(
                ([name, route]) =>
                    `${name}: ${route.distance_m} m`
            ).join(" | ");

            routePointStatus.textContent =
                "Routes calculated! " + summary;

            status.textContent =
                "Real EVA routes received from Flask.";

        } catch (error) {
            console.error("3D route calculation error:", error);

            routePointStatus.textContent =
                "Route error: " + error.message;

            status.textContent =
                "Could not calculate EVA routes.";
        } finally {
            button.disabled = false;
        }
    });


// ==========================================
// FIRST-PERSON ASTRONAUT FLYTHROUGH
// ==========================================

let astronautPath = [];
let astronautProgress = 0;
let astronautPlaying = false;
let astronautLastTime = null;

const astronautEyeHeight = 65;
const astronautBaseSpeed = 35;

// Build a path from the actual calculated EVA route
function prepareAstronautPath() {

    const routeName =
        document.getElementById("routeSelect").value;

    const route = evaRoutes?.[routeName];

    if (!route || !Array.isArray(route.path)) {
        routePointStatus.textContent =
            "Calculate an EVA route first.";
        return false;
    }

    const points = [];

    for (const [row, col] of route.path) {

        const { x, z } = routeGridToWorld(
            row,
            col,
            evaGridHeight,
            evaGridWidth
        );

        const y = getTerrainSurfaceHeight(x, z);

        if (y === null) continue;

        points.push(
            new THREE.Vector3(
                x,
                y + astronautEyeHeight,
                z
            )
        );
    }

    if (points.length < 2) {
        routePointStatus.textContent =
            "Not enough valid terrain points for flythrough.";
        return false;
    }

    astronautPath = points;
    astronautProgress = 0;
    astronautLastTime = null;

    return true;
}

// Position the camera along the astronaut path

function updateAstronautCamera() {

    if (astronautPath.length < 2) return;

    const index = Math.min(
        Math.floor(astronautProgress),
        astronautPath.length - 2
    );

    const fraction = Math.min(
        astronautProgress - index,
        1
    );

    const current = astronautPath[index]
        .clone()
        .lerp(astronautPath[index + 1], fraction);

    // Look several route points ahead instead of directly down
    const lookAheadIndex = Math.min(
        index + 8,
        astronautPath.length - 1
    );

    const lookTarget = astronautPath[lookAheadIndex].clone();

    // Keep the view closer to the horizon
    lookTarget.y = current.y + 10;

    camera.position.copy(current);
    camera.lookAt(lookTarget);
}


// Advance the astronaut each animation frame
function animateAstronaut(timestamp) {

    if (!astronautPlaying) return;

    if (astronautLastTime === null) {
        astronautLastTime = timestamp;
        return;
    }

    const deltaTime = Math.min(
        (timestamp - astronautLastTime) / 1000,
        0.1
    );

    astronautLastTime = timestamp;

    const speedMultiplier = Number(
        document.getElementById("speedSlider").value
    );

    astronautProgress +=
        deltaTime *
        astronautBaseSpeed *
        speedMultiplier /
        20;

    if (astronautProgress >= astronautPath.length - 1) {

        astronautProgress = astronautPath.length - 1;
        astronautPlaying = false;

        routePointStatus.textContent =
            "Astronaut reached the destination!";

    }

    updateAstronautCamera();
}


// ==========================================
// FIRST-PERSON PLAY / PAUSE CONTROLS
// ==========================================

document.getElementById("playRouteBtn")
    .addEventListener("click", () => {

        // Resume an existing paused flythrough
        if (
            astronautPath.length > 1 &&
            astronautProgress < astronautPath.length - 1
        ) {
            astronautPlaying = true;
            astronautLastTime = null;
            controls.enabled = false;

            routePointStatus.textContent =
                "Astronaut walking — first-person view!";
            return;
        }

        // Prepare the selected real EVA route
        if (!prepareAstronautPath()) {
            return;
        }

        astronautPlaying = true;
        astronautLastTime = null;

        // Disable mouse orbiting while walking
        controls.enabled = false;

        updateAstronautCamera();

        routePointStatus.textContent =
            "Astronaut walking — first-person view!";

    });

document.getElementById("pauseRouteBtn")
    .addEventListener("click", () => {

        astronautPlaying = false;
        astronautLastTime = null;

        routePointStatus.textContent =
            "Astronaut paused.";

    });

    // Start only after all astronaut variables are initialized
animate();
loadRealTerrain();