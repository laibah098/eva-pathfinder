// ============================================================
// MARS EVA PATHFINDER — ORBIT VIEW
// The 3D Mars globe, its two moons, and the switch between
// the globe and the planner window.
//
// Mars is always drawn behind the page. In "orbit" mode you
// explore the globe; in "planner" mode the planner window
// opens in front of it.
// ============================================================

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js";


// ------------------------------------------------------------
// 1. SETTINGS — safe to edit
// ------------------------------------------------------------

const CONFIG = {

    // The Mars surface image (an equirectangular world map).
    texture: "images/mars-globe.jpg",

    // Longitude at the LEFT edge of that image.
    //   -180  for NASA / USGS Viking maps (0° in the middle)
    //      0  for maps that run 0° to 360° east
    textureLeftEdgeLon: -180,

    // Shown at the bottom of the screen once the image has loaded.
    textureCredit: "Surface: Viking orbiter imagery, NASA / JPL / USGS. Moons are illustrative and not to scale.",

    // The highlighted site.
    site: {
        name: "Gale crater",
        lat: -5.4,          // degrees north (negative = south)
        lon: 137.8,         // degrees east
        diameterKm: 154,
        summary:
            "A 154 km impact basin just south of the Martian equator. " +
            "Mount Sharp rises 5.5 km from its floor, and the Curiosity " +
            "rover has explored it since 2012.",
        facts: [
            ["Diameter", "154 km"],
            ["Central peak", "Mount Sharp, 5.5 km"],
            ["Study area", "6.8 × 13.5 km at 4.8° S, 137.3° E"]
        ]
    },

    title: "Mars EVA Pathfinder",
    subtitle: "Mission navigation and landing site assessment",
    enterLabel: "Open the EVA planner",

    // The two moons. Sizes are enlarged so they can be seen, and Deimos is
    // drawn closer than it really is. Orbit speeds keep their real ratio
    // to Mars's rotation (Phobos laps the planet, Deimos barely moves).
    // "startAt" is where each moon begins, in degrees around Mars as seen
    // from above: 0 = between you and Mars, 90 = right, 180 = behind, 270 = left.
    moons: [
        { name: "Phobos", size: 0.038, shape: [1, 0.82, 0.68], orbit: 2.76, speed: 0.07,  startAt: 345, tilt: 0.02, seed: 11 },
        { name: "Deimos", size: 0.03,  shape: [1, 0.8, 0.73],  orbit: 4.3,  speed: 0.018, startAt: 215, tilt: 0.03, seed: 29 }
    ]
};


// ------------------------------------------------------------
// 2. CONSTANTS
// ------------------------------------------------------------

const MARS_RADIUS_KM = 3389.5;
const FOV = 35;                         // camera field of view, degrees
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const MIN_RING_PX = 9;                  // smallest the site ring is drawn
const RING_EXTENT = 5;                  // marker quad covers 5 ring radii
const SPIN_SPEED = 0.022;               // idle rotation of Mars, radians / second
const PLANNER_HASH = "#planner";
const ACCENT = "#7fb8f5";               // Martian-sunset blue

const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const root = document.documentElement;

// The planner window and its "Back to orbit" button live in index.html.
const plannerWindow = document.querySelector("[data-planner]");
const returnButton = document.querySelector("[data-return-to-orbit]");


// ------------------------------------------------------------
// 3. BUILD THE PAGE ELEMENTS
// ------------------------------------------------------------

const overlay = document.createElement("div");
overlay.className = "orbit";
overlay.setAttribute("role", "region");
overlay.setAttribute("aria-label", "Mars globe");

overlay.innerHTML = `
    <canvas class="orbit__canvas" tabindex="0"
        aria-label="Mars globe. Drag or use the arrow keys to rotate. Scroll or use plus and minus to zoom."></canvas>

    <div class="orbit__brand">
        <h1 class="orbit__title"></h1>
        <p class="orbit__subtitle"></p>
    </div>

    <p class="orbit__readout" aria-hidden="true"></p>

    <div class="orbit__tag" hidden>
        <svg class="orbit__leader" aria-hidden="true"><line /></svg>
        <button class="orbit__tag-button" type="button">
            <span class="orbit__tag-name"></span>
            <span class="orbit__tag-coords"></span>
            <span class="orbit__tag-action">Open the planner</span>
        </button>
    </div>

    <section class="orbit__site" aria-labelledby="orbit-site-name">
        <h2 class="orbit__site-name" id="orbit-site-name"></h2>
        <p class="orbit__site-summary"></p>
        <dl class="orbit__facts"></dl>
        <button class="orbit__enter" type="button"></button>
    </section>

    <div class="orbit__tools">
        <button class="orbit__tool" type="button" data-action="zoom-in"
            aria-label="Zoom in" title="Zoom in">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
        </button>
        <button class="orbit__tool" type="button" data-action="zoom-out"
            aria-label="Zoom out" title="Zoom out">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>
        </button>
        <button class="orbit__tool" type="button" data-action="find-site"
            aria-label="Turn Mars to ${CONFIG.site.name}" title="Turn Mars to ${CONFIG.site.name}">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>
        </button>
    </div>

    <p class="orbit__hint">Drag to rotate. Scroll or pinch to zoom. Click the blue ring to open the planner.</p>
    <p class="orbit__credit"></p>
`;

document.body.prepend(overlay);

const $ = (selector) => overlay.querySelector(selector);

const canvas = $(".orbit__canvas");
const readout = $(".orbit__readout");
const tag = $(".orbit__tag");
const tagButton = $(".orbit__tag-button");
const leaderLine = $(".orbit__leader line");
const enterButton = $(".orbit__enter");
const credit = $(".orbit__credit");

$(".orbit__title").textContent = CONFIG.title;
$(".orbit__subtitle").textContent = CONFIG.subtitle;
$(".orbit__tag-name").textContent = CONFIG.site.name;
$(".orbit__tag-coords").textContent = formatLatLon(CONFIG.site.lat, CONFIG.site.lon);
$(".orbit__site-name").textContent = CONFIG.site.name;
$(".orbit__site-summary").textContent = CONFIG.site.summary;
enterButton.textContent = CONFIG.enterLabel;
tagButton.setAttribute("aria-label", `${CONFIG.site.name}. ${CONFIG.enterLabel}.`);

for (const [label, value] of CONFIG.site.facts) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    $(".orbit__facts").append(row);
}


// ------------------------------------------------------------
// 4. HELPERS
// ------------------------------------------------------------

// Latitude / longitude (degrees) -> a point on the unit globe.
// Matches how three.js wraps an equirectangular image on a sphere.
function latLonToVector(lat, lon) {
    const u = THREE.MathUtils.euclideanModulo(lon - CONFIG.textureLeftEdgeLon, 360) / 360;
    const angle = u * Math.PI * 2;
    const polar = THREE.MathUtils.degToRad(90 - lat);

    return new THREE.Vector3(
        -Math.cos(angle) * Math.sin(polar),
        Math.cos(polar),
        Math.sin(angle) * Math.sin(polar)
    );
}

// A point on the unit globe -> latitude / longitude (degrees, 0–360° E).
function vectorToLatLon(v) {
    const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v.y, -1, 1)));
    const u = THREE.MathUtils.euclideanModulo(Math.atan2(v.z, -v.x) / (Math.PI * 2), 1);
    const lon = THREE.MathUtils.euclideanModulo(CONFIG.textureLeftEdgeLon + u * 360, 360);
    return { lat, lon };
}

function formatLatLon(lat, lon) {
    const ns = lat >= 0 ? "N" : "S";
    return `${Math.abs(lat).toFixed(1)}° ${ns}, ${lon.toFixed(1)}° E`;
}

// Repeatable 3D noise, used for the moons and the placeholder surface.
function hash3(x, y, z) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const mix = (a, b, t) => a + (b - a) * t;

    return mix(
        mix(mix(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
            mix(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
        mix(mix(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
            mix(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
        w
    );
}

function fbm3(x, y, z, octaves = 4) {
    let value = 0, amplitude = 0.5, frequency = 1, total = 0;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise3(x * frequency, y * frequency, z * frequency);
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2.07;
    }
    return value / total;
}


// ------------------------------------------------------------
// 5. THE 3D SCENE
// ------------------------------------------------------------

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const SUN_DIRECTION = new THREE.Vector3(-0.62, 0.36, 0.7).normalize();

const siteDirection = latLonToVector(CONFIG.site.lat, CONFIG.site.lon);
const siteRadiusRad = (CONFIG.site.diameterKm / 2) / MARS_RADIUS_KM;

let renderer, scene, camera, globe, marsMaterial, marker, markerMaterial, stars;
let moons = [];
let sceneReady = false;
let running = false;
let lastFrame = 0;
let frameCount = 0;

let mode = "orbit";             // "orbit" or "planner"

let minDistance = 2.2;          // closest zoom, set from the image resolution
let maxDistance = 9;            // furthest zoom, set from the window shape
let homeDistance = 5.2;         // whole-planet view, set from the window shape
let plannerDistance = 1.9;      // close view behind the planner window
let distance = 8;
let targetDistance = 5.2;

let width = 1;
let height = 1;

// Where Mars sits on screen, as a shift from the centre in pixels.
const view = { x: 0, y: 0, targetX: 0, targetY: 0 };

const spin = { x: 0, y: 0 };            // drag momentum, radians / second
let attract = !reducedMotion;           // slow idle rotation until first touch
let flight = null;                      // active "fly to" animation
let ringPixels = MIN_RING_PX;           // current on-screen radius of the site ring

function createScene() {

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 1);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);

    // --- Sunlight: fixed to the view, so the terminator stays put ---
    const sun = new THREE.DirectionalLight(0xfff4e8, 3.3);
    sun.position.copy(SUN_DIRECTION);
    scene.add(sun, new THREE.AmbientLight(0xffe2cc, 0.07));

    // --- Stars ---
    stars = createStars();
    scene.add(stars);

    // --- Mars ---
    globe = new THREE.Group();
    scene.add(globe);

    marsMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a1710,
        roughness: 1,
        metalness: 0
    });
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), marsMaterial));

    // --- Dust haze on the limb + soft halo beyond it ---
    scene.add(createLimbHaze(), createHalo());

    // --- Site marker ---
    marker = createMarker();
    globe.add(marker);

    // --- Phobos and Deimos, orbiting in Mars's equatorial plane ---
    moons = CONFIG.moons.map(createMoon);
    moons.forEach((moon) => globe.add(moon.mesh));

    // --- Starting pose: Mars tilted, site left of centre, drifting in ---
    globe.quaternion.copy(poseFacing(siteDirection, -0.5, 0.16));
    globe.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.2));

    // Put each moon where CONFIG asks, as seen from the starting view.
    const toMarsFrame = globe.quaternion.clone().invert();
    for (const moon of moons) {
        const around = THREE.MathUtils.degToRad(moon.startAt);
        const place = new THREE.Vector3(Math.sin(around), 0, Math.cos(around)).applyQuaternion(toMarsFrame);
        moon.angle = Math.atan2(place.x, place.z);
    }

    resize();
    view.x = view.targetX;
    view.y = view.targetY;
    distance = homeDistance * (reducedMotion ? 1 : 1.55);
    targetDistance = homeDistance;

    loadSurface();
    sceneReady = true;
}

function createStars() {
    const count = 3400;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const point = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
        point.randomDirection().multiplyScalar(120);
        positions.set([point.x, point.y, point.z], i * 3);

        const brightness = Math.pow(Math.random(), 3.2);     // most stars are faint
        sizes[i] = 0.9 + brightness * 2.1;
        alphas[i] = 0.32 + brightness * 0.68;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
        vertexShader: `
            attribute float aSize;
            attribute float aAlpha;
            uniform float uPixelRatio;
            varying float vAlpha;
            void main() {
                vAlpha = aAlpha;
                gl_PointSize = aSize * uPixelRatio;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float a = (1.0 - smoothstep(0.35, 1.0, d)) * vAlpha;
                gl_FragColor = vec4(vec3(0.93, 0.95, 1.0), a);
            }
        `,
        transparent: true,
        depthWrite: false
    });

    return new THREE.Points(geometry, material);
}

// Thin atmospheric haze that brightens toward the edge of the disc.
function createLimbHaze() {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uSun: { value: SUN_DIRECTION },
            uColor: { value: new THREE.Color("#f0b48a") }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform vec3 uSun;
            uniform vec3 uColor;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
                vec3 n = normalize(vNormal);
                float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.6);
                float lit = smoothstep(-0.25, 0.45, dot(n, uSun));
                gl_FragColor = vec4(uColor, rim * lit * 0.55);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    return new THREE.Mesh(new THREE.SphereGeometry(1.004, 96, 48), material);
}

// Soft glow just outside the planet, strongest on the sunlit side.
function createHalo() {
    const shellRadius = 1.13;
    const edge = Math.sqrt(1 - 1 / (shellRadius * shellRadius));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uSun: { value: SUN_DIRECTION },
            uColor: { value: new THREE.Color("#e79a6c") },
            uEdge: { value: edge }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vView = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform vec3 uSun;
            uniform vec3 uColor;
            uniform float uEdge;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
                vec3 n = normalize(vNormal);
                float depth = clamp(-dot(n, normalize(vView)) / uEdge, 0.0, 1.0);
                float glow = pow(depth, 2.6);
                float lit = smoothstep(-0.5, 0.6, dot(n, uSun));
                gl_FragColor = vec4(uColor, glow * (0.12 + lit * 0.5));
                #include <colorspace_fragment>
            }
        `,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    return new THREE.Mesh(new THREE.SphereGeometry(shellRadius, 96, 48), material);
}

// A ring drawn on the surface at the crater rim, with a slow pulse.
function createMarker() {
    markerMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(ACCENT) },
            uMotion: { value: reducedMotion ? 0 : 1 },
            uHover: { value: 0 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uMotion;
            uniform float uHover;
            uniform vec3 uColor;
            varying vec2 vUv;

            float ring(float rho, float radius, float w) {
                return 1.0 - smoothstep(w * 0.8, w * 2.0, abs(rho - radius));
            }

            void main() {
                float rho = length(vUv - 0.5) * 2.0 * ${RING_EXTENT.toFixed(1)};
                float w = fwidth(rho) * (1.0 + uHover * 0.6);

                float alpha = ring(rho, 1.0, w);

                for (int i = 0; i < 2; i++) {
                    float t = fract(uTime / 3.2 + float(i) * 0.5);
                    float radius = mix(1.0, 4.4, t);
                    float fade = (1.0 - t) * (1.0 - t);
                    alpha = max(alpha, ring(rho, radius, w) * fade * 0.75 * uMotion);
                }

                float fill = (1.0 - smoothstep(1.0 - w, 1.0, rho)) * (0.12 + uHover * 0.2);
                alpha = max(alpha, fill);

                if (alpha < 0.004) discard;
                gl_FragColor = vec4(uColor, alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), markerMaterial);
    mesh.position.copy(siteDirection).multiplyScalar(1.0025);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), siteDirection);
    mesh.renderOrder = 2;
    return mesh;
}

// A small, lumpy, cratered moon.
function createMoon(settings) {
    const geometry = new THREE.IcosahedronGeometry(1, 24);
    const positions = geometry.attributes.position;
    const colours = new Float32Array(positions.count * 3);
    const seed = settings.seed;

    // A few craters at repeatable places; the first is the large one.
    const craters = [];
    for (let i = 0; i < 9; i++) {
        craters.push({
            centre: new THREE.Vector3(
                hash3(seed, i, 1) - 0.5, hash3(seed, i, 2) - 0.5, hash3(seed, i, 3) - 0.5
            ).normalize(),
            radius: i === 0 ? 0.62 : 0.14 + hash3(seed, i, 4) * 0.2,
            depth: i === 0 ? 0.2 : 0.05 + hash3(seed, i, 5) * 0.06
        });
    }

    const point = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).normalize();

        // Overall lumpiness
        let radius = 1 + 0.3 * (fbm3(point.x * 1.4 + seed, point.y * 1.4, point.z * 1.4, 3) - 0.5)
                       + 0.07 * (fbm3(point.x * 6 + seed, point.y * 6, point.z * 6, 3) - 0.5);
        let shade = 0.82 + 0.3 * (fbm3(point.x * 3 + seed * 2, point.y * 3, point.z * 3, 3) - 0.5);

        // Crater bowls with a slightly raised rim
        for (const crater of craters) {
            const rho = point.angleTo(crater.centre) / crater.radius;
            if (rho < 1.5) {
                if (rho < 1) {
                    radius -= crater.depth * (1 - rho * rho);
                    shade -= 0.1 * (1 - rho);
                }
                radius += crater.depth * 0.18 * Math.exp(-Math.pow((rho - 1) / 0.22, 2));
            }
        }

        point.multiplyScalar(radius);
        positions.setXYZ(
            i,
            point.x * settings.shape[0],
            point.y * settings.shape[1],
            point.z * settings.shape[2]
        );

        // Dark grey-brown rock
        colours[i * 3] = 0.62 * shade;
        colours[i * 3 + 1] = 0.56 * shade;
        colours[i * 3 + 2] = 0.51 * shade;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(settings.size);

    return {
        ...settings,
        mesh,
        angle: 0,
        world: new THREE.Vector3()
    };
}

const moonBasis = new THREE.Matrix4();
const moonToMars = new THREE.Vector3();
const moonForward = new THREE.Vector3();

function updateMoons(dt) {
    for (const moon of moons) {

        // Moons are attached to Mars, so take Mars's own idle spin back out:
        // their speed should not depend on whether the planet is turning.
        if (!reducedMotion) {
            moon.angle += (moon.speed - (attract && !flight ? SPIN_SPEED : 0)) * dt;
        }

        // Position on a near-equatorial orbit (Mars's north is +Y)
        moon.mesh.position.set(
            Math.sin(moon.angle) * moon.orbit,
            Math.sin(moon.angle + 1.3) * moon.orbit * Math.sin(moon.tilt),
            Math.cos(moon.angle) * moon.orbit
        );

        // Tidally locked: the long axis always points at Mars
        moonToMars.copy(moon.mesh.position).normalize().negate();
        moonForward.crossVectors(moonToMars, AXIS_Y).normalize();
        moonBasis.makeBasis(moonToMars, AXIS_Y, moonForward);
        moon.mesh.quaternion.setFromRotationMatrix(moonBasis);

        // Darken the moon while it is inside Mars's shadow
        moon.world.copy(moon.mesh.position).applyQuaternion(globe.quaternion);
        const alongSun = moon.world.dot(SUN_DIRECTION);
        const offAxis = Math.sqrt(Math.max(moon.world.lengthSq() - alongSun * alongSun, 0));
        const lit = alongSun > 0 ? 1 : THREE.MathUtils.smoothstep(offAxis, 0.94, 1.1);
        moon.mesh.material.color.setScalar(0.05 + 0.95 * lit);
    }
}

// Create floating identification tags for Mars's moons
const moonLabels = document.createElement("div");

moonLabels.style.position = "absolute";
moonLabels.style.inset = "0";
moonLabels.style.pointerEvents = "none";
moonLabels.style.zIndex = "20";

const moonContainer = document.querySelector(".orbit");
moonContainer.appendChild(moonLabels);

const moonTags = [];

function ensureMoonLabels() {
    moons.forEach((moon, index) => {
        if (moonTags.some(item => item.moon === moon)) return;

        const tag = document.createElement("div");
        tag.className = "orbit__moon-label";

        tag.innerHTML = `
            ${index === 0 ? "PHOBOS" : "DEIMOS"}
            <span style="display:block;font-size:9px;opacity:.65;margin-top:3px">
                MARS MOON 0${index + 1}
            </span>
        `;

        moonLabels.appendChild(tag);
        moonTags.push({ moon, tag });
    });
}

// Keep moon labels attached to the moving moons
function updateMoonLabels() {
    ensureMoonLabels();

    const rect = moonContainer.getBoundingClientRect();

    // Hide moon tags when the globe is not visible
const globeVisible =
    moonContainer.getClientRects().length > 0 &&
    rect.width > 0 &&
    rect.height > 0;

if (!globeVisible) {
    moonTags.forEach(({ tag }) => {
        tag.style.display = "none";
    });
    return;
}

    for (const { moon, tag } of moonTags) {
        const position = new THREE.Vector3();

        moon.mesh.getWorldPosition(position);
        position.project(camera);

        const x = (position.x * 0.5 + 0.5) * rect.width;
        const y = (-position.y * 0.5 + 0.5) * rect.height;

        tag.style.left = `${x}px`;
        tag.style.top = `${y}px`;

        tag.style.display =
            position.z < 1 && position.z > -1
                ? "block"
                : "none";
    }
}
// ------------------------------------------------------------
// 6. THE MARS SURFACE IMAGE
// ------------------------------------------------------------

function loadSurface() {
    new THREE.TextureLoader().load(
        CONFIG.texture,
        (texture) => {
            const limit = Math.min(renderer.capabilities.maxTextureSize, 8192);
            const image = texture.image;
            let surface = texture;

            // Very large images are scaled down so every graphics card can show them.
            if (image.width > limit) {
                const scaled = document.createElement("canvas");
                scaled.width = limit;
                scaled.height = Math.round(limit * image.height / image.width);
                scaled.getContext("2d").drawImage(image, 0, 0, scaled.width, scaled.height);
                surface = new THREE.CanvasTexture(scaled);
                texture.dispose();
            }

            const pixelsWide = Math.min(image.width, limit);
            minDistance = pixelsWide >= 8000 ? 1.5 : pixelsWide >= 3800 ? 1.8 : 2.2;

            applySurface(surface);
            credit.textContent = CONFIG.textureCredit;
        },
        undefined,
        () => {
            console.warn(
                `[Orbit view] Could not load "${CONFIG.texture}". ` +
                "Showing a generated placeholder surface instead."
            );
            minDistance = 2.2;
            applySurface(createPlaceholderSurface());
            credit.textContent =
                `Placeholder surface. Add ${CONFIG.texture} to show real Mars imagery.`;
            credit.classList.add("orbit__credit--notice");
        }
    );
}

function applySurface(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;

    marsMaterial.map = texture;
    marsMaterial.color.set(0xffffff);
    marsMaterial.needsUpdate = true;

    if (mode === "orbit") {
        targetDistance = THREE.MathUtils.clamp(targetDistance, minDistance, maxDistance);
    }
    overlay.classList.add("is-ready");
}

// A generated Mars-like surface, used only when the real image is missing.
function createPlaceholderSurface() {
    const w = 1024;
    const h = 512;
    const surface = document.createElement("canvas");
    surface.width = w;
    surface.height = h;
    const context = surface.getContext("2d");
    const pixels = context.createImageData(w, h);

    const dark = [92, 52, 36], mid = [176, 88, 48], light = [222, 158, 104], ice = [240, 234, 226];
    const blend = (a, b, t) => a.map((channel, i) => channel + (b[i] - channel) * t);

    for (let y = 0; y < h; y++) {
        const polar = (y + 0.5) / h * Math.PI;
        for (let x = 0; x < w; x++) {
            const angle = (x + 0.5) / w * Math.PI * 2;
            const px = Math.cos(angle) * Math.sin(polar);
            const py = Math.cos(polar);
            const pz = Math.sin(angle) * Math.sin(polar);

            const broad = fbm3(px * 1.6 + 3.1, py * 1.6, pz * 1.6, 5);
            const fine = fbm3(px * 7 + 9.2, py * 7, pz * 7, 5);

            let colour = blend(mid, light, THREE.MathUtils.smoothstep(broad, 0.42, 0.7));
            colour = blend(colour, dark, (1 - THREE.MathUtils.smoothstep(fine * 0.5 + broad * 0.5, 0.3, 0.52)) * 0.75);

            const cap = THREE.MathUtils.smoothstep(Math.abs(py) + fine * 0.05, 0.955, 0.985);
            colour = blend(colour, ice, cap);

            const index = (y * w + x) * 4;
            pixels.data[index] = colour[0];
            pixels.data[index + 1] = colour[1];
            pixels.data[index + 2] = colour[2];
            pixels.data[index + 3] = 255;
        }
    }

    context.putImageData(pixels, 0, 0);
    return new THREE.CanvasTexture(surface);
}


// ------------------------------------------------------------
// 7. CAMERA, SIZE AND ZOOM
// ------------------------------------------------------------

// Globe rotation that brings a surface point to face the viewer, north up.
// "yawOffset" and "pitchOffset" (radians) leave it off-centre on purpose.
function poseFacing(direction, yawOffset = 0, pitchOffset = 0) {
    const yaw = -Math.atan2(direction.x, direction.z) + yawOffset;
    const pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) + pitchOffset;

    return new THREE.Quaternion()
        .setFromAxisAngle(AXIS_X, pitch)
        .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yaw));
}

// Camera distance at which Mars appears with the given radius in pixels.
function distanceForRadius(radiusPixels) {
    const halfAngle = Math.atan(radiusPixels * TAN_HALF_FOV / (height / 2));
    return 1 / Math.sin(halfAngle);
}

function resize() {
    width = Math.max(overlay.clientWidth, 1);
    height = Math.max(overlay.clientHeight, 1);

    renderer.setSize(width, height, false);
    camera.aspect = width / height;

    const wide = width >= 900;

    // Whole-planet view for exploring
    const fill = wide ? 0.62 : 0.74;
    const previousHome = homeDistance;
    homeDistance = Math.max(distanceForRadius(fill * Math.min(width, height) / 2), 3);
    maxDistance = Math.max(9, homeDistance * 1.5);

    // Close view that looms behind the planner window
    plannerDistance = Math.max(distanceForRadius(0.62 * Math.max(width, height)), 1.35);

    if (mode === "orbit") {
        // On wide screens Mars sits right of centre, clear of the text.
        // On narrow screens it sits above the text instead.
        view.targetX = wide ? width * 0.13 : 0;
        view.targetY = wide ? 0 : -height * 0.13;

        if (Math.abs(targetDistance - previousHome) < 0.01) {
            targetDistance = homeDistance;
        }
    } else {
        // Behind the planner, Mars fills the lower right, so its sunlit edge
        // and the stars show along the left and top of the window.
        view.targetX = wide ? width * 0.14 : width * 0.2;
        view.targetY = wide ? height * 0.12 : height * 0.16;
        targetDistance = plannerDistance;
    }
}

function applyView() {
    camera.setViewOffset(width, height, -view.x, -view.y, width, height);
    camera.updateProjectionMatrix();
}

function zoomBy(factor) {
    targetDistance = THREE.MathUtils.clamp(targetDistance * factor, minDistance, maxDistance);
}

// Radians of globe rotation per pixel dragged, so the surface
// stays under the cursor at any zoom level.
function radiansPerPixel() {
    return (2 * TAN_HALF_FOV * (distance - 1)) / height;
}

function rotateByPixels(dx, dy) {
    const k = radiansPerPixel();
    globe.quaternion
        .premultiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, dx * k))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, dy * k))
        .normalize();
}

function flyTo(direction, toDistance, duration = 1700) {
    attract = false;
    spin.x = spin.y = 0;

    const to = poseFacing(direction);

    if (reducedMotion || duration === 0) {
        flight = null;
        globe.quaternion.copy(to);
        distance = targetDistance = toDistance;
        view.x = view.targetX;
        view.y = view.targetY;
        return;
    }

    flight = {
        from: globe.quaternion.clone(),
        to,
        fromDistance: distance,
        toDistance,
        start: performance.now(),
        duration
    };
}

function cancelFlight() {
    flight = null;
}


// ------------------------------------------------------------
// 8. DRAG, SCROLL, PINCH, CLICK AND KEYBOARD
// ------------------------------------------------------------

const pointers = new Map();
let lastPinchGap = 0;
let lastMoveTime = 0;
let draggedDistance = 0;
let pressedOnSite = false;

function userTookControl() {
    attract = false;
    cancelFlight();
    overlay.classList.add("has-interacted");
}

// Is this screen position on the highlighted ring?
function isOverSite(clientX, clientY) {
    if (!sceneReady || tag.hidden) return false;

    const rect = canvas.getBoundingClientRect();
    const reach = Math.max(ringPixels + 10, 24);
    return Math.hypot(clientX - rect.left - siteScreenX, clientY - rect.top - siteScreenY) <= reach;
}

canvas.addEventListener("pointerdown", (event) => {
    if (mode !== "orbit") return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    spin.x = spin.y = 0;
    draggedDistance = 0;
    lastMoveTime = performance.now();
    pressedOnSite = pointers.size === 1 && isOverSite(event.clientX, event.clientY);
    userTookControl();
    overlay.classList.add("is-dragging");

    if (pointers.size === 2) {
        lastPinchGap = pinchGap();
    }
});

canvas.addEventListener("pointermove", (event) => {
    if (!sceneReady || mode !== "orbit") return;

    const previous = pointers.get(event.pointerId);

    if (!previous) {
        updateHover(event.clientX, event.clientY);
        return;
    }

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    previous.x = event.clientX;
    previous.y = event.clientY;

    if (pointers.size === 1) {
        rotateByPixels(dx, dy);
        draggedDistance += Math.abs(dx) + Math.abs(dy);

        const now = performance.now();
        const seconds = Math.max((now - lastMoveTime) / 1000, 1 / 240);
        const k = radiansPerPixel();
        spin.y = THREE.MathUtils.lerp(spin.y, (dx * k) / seconds, 0.5);
        spin.x = THREE.MathUtils.lerp(spin.x, (dy * k) / seconds, 0.5);
        lastMoveTime = now;

    } else if (pointers.size === 2) {
        const gap = pinchGap();
        if (lastPinchGap > 0 && gap > 0) {
            zoomBy(lastPinchGap / gap);
        }
        lastPinchGap = gap;
    }
});

function releasePointer(event) {
    if (!pointers.delete(event.pointerId)) return;

    if (pointers.size === 0) {
        overlay.classList.remove("is-dragging");

        // No throw if the pointer had stopped before release.
        if (performance.now() - lastMoveTime > 90 || reducedMotion) {
            spin.x = spin.y = 0;
        }

        // A click (not a drag) on the blue ring opens the planner.
        if (event.type === "pointerup" && pressedOnSite && draggedDistance < 6 &&
            isOverSite(event.clientX, event.clientY)) {
            spin.x = spin.y = 0;
            openPlanner();
        }
    }

    pressedOnSite = false;
    lastPinchGap = 0;
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

canvas.addEventListener("pointerleave", () => {
    readout.textContent = "";
    setSiteHover(false);
});

function pinchGap() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (mode !== "orbit") return;
    userTookControl();

    const amount = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY;
    zoomBy(Math.exp(THREE.MathUtils.clamp(amount, -240, 240) * 0.0014));
}, { passive: false });

canvas.addEventListener("dblclick", (event) => {
    if (mode !== "orbit" || isOverSite(event.clientX, event.clientY)) return;
    userTookControl();
    zoomBy(0.7);
});

canvas.addEventListener("keydown", (event) => {
    if (mode !== "orbit") return;

    const step = 40;
    const actions = {
        ArrowLeft: () => rotateByPixels(-step, 0),
        ArrowRight: () => rotateByPixels(step, 0),
        ArrowUp: () => rotateByPixels(0, -step),
        ArrowDown: () => rotateByPixels(0, step),
        "+": () => zoomBy(0.8),
        "=": () => zoomBy(0.8),
        "-": () => zoomBy(1.25)
    };

    if (actions[event.key]) {
        event.preventDefault();
        userTookControl();
        actions[event.key]();
    }
});

overlay.querySelector(".orbit__tools").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || mode !== "orbit") return;

    if (button.dataset.action === "zoom-in") {
        userTookControl();
        zoomBy(0.72);
    }
    if (button.dataset.action === "zoom-out") {
        userTookControl();
        zoomBy(1 / 0.72);
    }
    if (button.dataset.action === "find-site") {
        overlay.classList.add("has-interacted");
        flyTo(siteDirection, Math.max(minDistance, Math.min(2.6, homeDistance)));
    }
});

// The label and the big button both open the planner.
tagButton.addEventListener("click", openPlanner);
enterButton.addEventListener("click", openPlanner);

tagButton.addEventListener("pointerenter", () => setSiteHover(true));
tagButton.addEventListener("pointerleave", () => setSiteHover(false));


// ------------------------------------------------------------
// 9. WHAT IS UNDER THE CURSOR
// ------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
const moonSphere = new THREE.Sphere();
const hitPoint = new THREE.Vector3();
const pointerNdc = new THREE.Vector2();

function setSiteHover(active) {
    if (!sceneReady) return;
    markerMaterial.uniforms.uHover.value = active ? 1 : 0;
    tag.classList.toggle("is-hover", active);
    canvas.classList.toggle("is-over-site", active);
}

function updateHover(clientX, clientY) {
    const overSite = isOverSite(clientX, clientY);
    setSiteHover(overSite);

    const rect = canvas.getBoundingClientRect();
    pointerNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);

    // A moon?
    for (const moon of moons) {
        moonSphere.set(moon.world, moon.size * 1.6);
        if (raycaster.ray.intersectsSphere(moonSphere) &&
            (moon.world.z > 0 || Math.hypot(moon.world.x, moon.world.y) > 1)) {
            readout.textContent = moon.name;
            return;
        }
    }

    // A point on Mars?
    if (!raycaster.ray.intersectSphere(unitSphere, hitPoint)) {
        readout.textContent = "";
        return;
    }

    hitPoint.applyQuaternion(globe.quaternion.clone().invert());
    const { lat, lon } = vectorToLatLon(hitPoint);
    readout.textContent = overSite
        ? `${CONFIG.site.name}: click to open the planner`
        : formatLatLon(lat, lon);
}


// ------------------------------------------------------------
// 10. THE SITE LABEL (follows the marker around the globe)
// ------------------------------------------------------------

const siteWorld = new THREE.Vector3();
const siteProjected = new THREE.Vector3();
const toCamera = new THREE.Vector3();
let siteScreenX = 0;
let siteScreenY = 0;

function updateMarkerAndLabel() {

    // Keep the ring at least a few pixels wide when zoomed out;
    // once you zoom in, it matches the true 154 km rim.
    const pixelsPerUnit = height / (2 * TAN_HALF_FOV * Math.max(distance - 1, 0.05));
    const truePixels = siteRadiusRad * pixelsPerUnit;
    ringPixels = Math.max(truePixels, MIN_RING_PX);
    marker.scale.setScalar(RING_EXTENT * siteRadiusRad * (ringPixels / truePixels));

    // Is the site on the side of Mars facing us?
    siteWorld.copy(siteDirection).applyQuaternion(globe.quaternion);
    toCamera.copy(camera.position).sub(siteWorld).normalize();
    const facing = siteWorld.dot(toCamera);

    if (facing < 0.08 || mode !== "orbit") {
        tag.hidden = true;
        return;
    }

    siteProjected.copy(siteWorld).project(camera);
    siteScreenX = (siteProjected.x * 0.5 + 0.5) * width;
    siteScreenY = (-siteProjected.y * 0.5 + 0.5) * height;

    const flip = siteScreenX > width - 250;
    const side = flip ? -1 : 1;
    const start = ringPixels * 0.7071 + 4;
    const end = start + 26;

    tag.hidden = false;
    tag.style.transform = `translate(${siteScreenX.toFixed(1)}px, ${siteScreenY.toFixed(1)}px)`;
    tag.style.opacity = THREE.MathUtils.smoothstep(facing, 0.08, 0.3).toFixed(2);
    tag.classList.toggle("orbit__tag--flip", flip);

    leaderLine.setAttribute("x1", side * start);
    leaderLine.setAttribute("y1", -start);
    leaderLine.setAttribute("x2", side * end);
    leaderLine.setAttribute("y2", -end);

    tagButton.style.setProperty("--tag-x", `${side * (end + 6)}px`);
    tagButton.style.setProperty("--tag-y", `${-(end - 2)}px`);
}


// ------------------------------------------------------------
// 11. ANIMATION LOOP
// ------------------------------------------------------------

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    // Behind the planner window, half the frame rate is plenty.
    frameCount++;
    if (mode === "planner" && !flight && frameCount % 2 === 1) return;

    const now = performance.now();
    const dt = THREE.MathUtils.clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;

    const ease = 1 - Math.exp(-dt * 5);

    if (flight) {
        const t = Math.min((now - flight.start) / flight.duration, 1);
        const eased = easeInOut(t);

        globe.quaternion.slerpQuaternions(flight.from, flight.to, eased);
        distance = THREE.MathUtils.lerp(flight.fromDistance, flight.toDistance, eased);
        targetDistance = distance;

        if (t >= 1) flight = null;

    } else {
        // Slow turn about Mars's own axis until someone takes hold of it.
        if (attract) {
            globe.quaternion.multiply(
                new THREE.Quaternion().setFromAxisAngle(AXIS_Y, SPIN_SPEED * dt)
            );
        }

        // Momentum after a drag is released.
        if (pointers.size === 0 && (spin.x !== 0 || spin.y !== 0)) {
            globe.quaternion
                .premultiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, spin.y * dt))
                .premultiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, spin.x * dt))
                .normalize();

            const friction = Math.exp(-dt * 2.6);
            spin.x *= friction;
            spin.y *= friction;
            if (Math.hypot(spin.x, spin.y) < 0.002) spin.x = spin.y = 0;
        }

        distance += (targetDistance - distance) * (1 - Math.exp(-dt * 6));
    }

    // Glide Mars to its place on screen (centre-right in orbit, lower left behind the planner).
    view.x += (view.targetX - view.x) * ease;
    view.y += (view.targetY - view.y) * ease;
    applyView();

    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);

    stars.rotation.y += dt * 0.0015;
    markerMaterial.uniforms.uTime.value = now / 1000;

    updateMoons(dt);
    updateMoonLabels();
    updateMarkerAndLabel();
    renderer.render(scene, camera);
}

function startLoop() {
    if (running || !sceneReady) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
}

function stopLoop() {
    running = false;
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop();
    else startLoop();
});

window.addEventListener("resize", () => {
    if (sceneReady) resize();
});


// ------------------------------------------------------------
// 12. SWITCHING BETWEEN ORBIT AND THE PLANNER
// ------------------------------------------------------------

// Remembers which view is open in the page address, where the browser allows it.
function setAddress(address) {
    try {
        history.replaceState(null, "", address);
    } catch (error) {
        // Some embedded viewers do not allow this; the site works without it.
    }
}

function setMode(newMode) {
    mode = newMode;

    root.classList.toggle("orbit-open", mode === "orbit");
    root.classList.toggle("planner-open", mode === "planner");

    if (plannerWindow) plannerWindow.inert = mode !== "planner";
    canvas.tabIndex = mode === "orbit" ? 0 : -1;

    readout.textContent = "";
    if (sceneReady) {
        setSiteHover(false);
        resize();
    }
}

function openPlanner(options = {}) {
    if (mode === "planner") return;

    overlay.classList.add("has-interacted");
    setMode("planner");
    setAddress(PLANNER_HASH);

    if (sceneReady) {
        flyTo(siteDirection, plannerDistance, options.instant ? 0 : 1700);
    }

    // Lets the map re-measure itself now that its window is visible.
    window.dispatchEvent(new Event("resize"));

    if (returnButton && !options.instant) {
        returnButton.focus({ preventScroll: true });
    }
}

function openOrbit() {
    if (mode === "orbit" || !sceneReady) return;

    setMode("orbit");
    setAddress(location.pathname + location.search);
    flyTo(siteDirection, homeDistance, 1400);
    enterButton.focus({ preventScroll: true });
}

if (returnButton) {
    returnButton.addEventListener("click", openOrbit);
}


// ------------------------------------------------------------
// 13. START
// ------------------------------------------------------------

try {
    createScene();
} catch (error) {
    // No 3D graphics on this device: go straight to the planner on a plain background.
    console.warn("[Orbit view] 3D graphics are not available.", error);
    overlay.classList.add("is-unavailable");
    if (returnButton) returnButton.hidden = true;
}

// A page address ending in #planner opens the planner directly.
// (Handy while developing: refreshing keeps you where you were.)
if (!sceneReady || location.hash === PLANNER_HASH) {
    root.classList.add("no-transition");
    openPlanner({ instant: true });
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transition")));
} else {
    setMode("orbit");
}

startLoop();
