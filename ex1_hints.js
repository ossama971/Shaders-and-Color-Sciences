/**
 * ex1_hints.js — Exercise 1: Color-Space Point-Cloud Visualization
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ============================================================================
// ASSET PATH
// ============================================================================

const IMAGE_PATH = "./Assests/grenouille.jpg";
const VIDEO_PATH = "./Assests/video.mp4";

// ============================================================================
// PERFORMANCE CONFIGURATION
// ============================================================================
// SUBSAMPLE_FACTOR: 1 = every pixel, 4 = every 4th pixel in each direction.
// Increase for better performance; decrease for higher point count.

const SUBSAMPLE_FACTOR = 1;
const SHADOW_SUBSAMPLE_MULTI = 4; // shadow uses less points as direct
const DENSITY_SUBSAMPLE_MULTI = 1; // density uses more points

// ============================================================================
// COLOR SPACE CONFIGURATION
// ============================================================================
// Each entry drives: the GUI dropdown, the 3D axis display, and the integer
// uniform sent to the vertex shader to select the correct position mapping.
//
// shaderMode values: RGB=0, HSV=1, CIEXYZ=2, CIExyY=3, CIELAB=4, CIELCH=5
//
// axes[0] -> x-axis (right), axes[1] -> y-axis (up), axes[2] -> z-axis (forward)

const COLOR_SPACES = {
  sRGB: {
    name: "sRGB",
    axes: [
      { name: "R", colorStart: 0x000000, colorEnd: 0xff0000, range: [0, 1] },
      { name: "B", colorStart: 0x000000, colorEnd: 0x0000ff, range: [0, 1] },
      { name: "G", colorStart: 0x000000, colorEnd: 0x00ff00, range: [0, 1] },
    ],
    positionMapping: { x: "R", y: "B", z: "G" },
    shaderMode: 0,
  },
  HSV: {
    name: "HSV",
    axes: [
      { name: "H", colorStart: 0x000000, colorEnd: 0xff0088, range: [0, 1] },
      { name: "V", colorStart: 0x000000, colorEnd: 0x00ffff, range: [0, 1] },
      { name: "S", colorStart: 0x000000, colorEnd: 0xffff00, range: [0, 1] },
    ],
    positionMapping: { x: "H", y: "V", z: "S" },
    shaderMode: 1,
  },
  CIEXYZ: {
    name: "CIEXYZ",
    axes: [
      { name: "X", colorStart: 0x000000, colorEnd: 0xff6600, range: [0, 0.95] },
      { name: "Y", colorStart: 0x000000, colorEnd: 0xaaff00, range: [0, 1.0] },
      { name: "Z", colorStart: 0x000000, colorEnd: 0x0066ff, range: [0, 1.09] },
    ],
    // Y is luminance -> vertical axis; X/Z normalised by D65 white-point values.
    positionMapping: { x: "X/Xn", y: "Y", z: "Z/Zn" },
    shaderMode: 2,
  },
  CIExyY: {
    name: "CIExyY",
    axes: [
      { name: "x", colorStart: 0x000000, colorEnd: 0xff6600, range: [0, 0.8] },
      { name: "Y", colorStart: 0x000000, colorEnd: 0xaaff00, range: [0, 1] },
      { name: "y", colorStart: 0x000000, colorEnd: 0x0066ff, range: [0, 0.9] },
    ],
    // Y luminance on vertical; x and y chromaticity on the horizontal plane.
    positionMapping: { x: "x-chroma", y: "Y-luma", z: "y-chroma" },
    shaderMode: 3,
  },
  CIELAB: {
    name: "CIELAB",
    axes: [
      // a* red-green opposition: green end (−a*) → magenta end (+a*)
      {
        name: "a*",
        colorStart: 0x00cc44,
        colorEnd: 0xff0066,
        range: [-100, 100],
      },
      // L* luminance: black (L*=0) → white (L*=100)
      { name: "L*", colorStart: 0x000000, colorEnd: 0xffffff, range: [0, 100] },
      // b* yellow-blue opposition: blue end (−b*) → yellow end (+b*)
      {
        name: "b*",
        colorStart: 0x0055ff,
        colorEnd: 0xffaa00,
        range: [-100, 100],
      },
    ],
    // L* on vertical; a* (red-green) on x; b* (yellow-blue) on z.
    // Neutral greys (a*=b*=0) cluster on the central vertical axis.
    // Axes run corner-to-corner; a*=0 and b*=0 naturally land at the midpoint (cube centre).
    // centered: false keeps axis arrows at the cube edge like RGB/HSV.
    positionMapping: { x: "a*", y: "L*", z: "b*" },
    shaderMode: 4,
    centered: false,
  },
  CIELCH: {
    name: "CIELCH",
    axes: [
      {
        name: "C*",
        colorStart: 0x777777, // achromatic grey at C*=0
        colorEnd: 0xff5500, // vivid orange at high C*
        range: [0, 100],
      },
      { name: "L*", colorStart: 0x000000, colorEnd: 0xffffff, range: [0, 100] },
      {
        name: "H",
        colorStart: 0xff0000, // H=0° (red)
        colorEnd: 0xcc00ff, // H=360° (violet, wraps back toward red)
        range: [0, 360],
      },
    ],
    // Cartesian LCH: C* on X, H on Z, L* on Y.
    // Different from CIELAB (a*/b* polar plane) — C* and H are explicit separate axes.
    positionMapping: { x: "C*", y: "L*", z: "H" },
    shaderMode: 5,
    centered: false,
  },
};

// ============================================================================
// SHADER ASSEMBLY -- reads GLSL from <script type="x-shader/..."> blocks
// ============================================================================

/** Reads a shader block from the HTML by id. */
function getShaderSource(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing shader element #${id} in the html file`);
  return el.textContent.trim(); // to catch accidental whitespace errors.
}
/** Replaces a token in a shader source string with the given replacement. */
function injectToken(src, token, replacement, label) {
  if (!src.includes(token)) {
    //throw error if token is not found
    throw new Error(`Token "${token}" not found while building ${label}.`);
  }
  return src.replace(token, replacement);
}

// Read raw sources from HTML blocks
const CONVERSIONS_SRC = getShaderSource("shaderConversions"); // convert in GLSL for faster GPU execution especially for video mode
const TEX_VERT = getShaderSource("texVertexShader");
const TEX_FRAG = getShaderSource("texFragmentShader");
const POINTS_FRAG = getShaderSource("pointsFragmentShader");
const DENSITY_FRAG = getShaderSource("densityFragmentShader");
const SHADOW_FRAG = getShaderSource("shadowFragmentShader");

// Build points vertex shader:
//   1. Inject conversions library at the __SHADER_CONVERSIONS__ token.
//   2. Set point-size expression at the __POINT_SIZE__ token.
const POINTS_VERT_BASE = injectToken(
  getShaderSource("pointsVertexShader"),
  "__SHADER_CONVERSIONS__",
  CONVERSIONS_SRC,
  "pointsVertexShader",
);

// different point size depending on visual mode.
const POINTS_VERT = injectToken(
  POINTS_VERT_BASE,
  "__POINT_SIZE__",
  "max(6.0 / -mvPos.z, 1.0)",
  "POINTS_VERT",
); // points size changes with distance for better visibility; minimum size of 1.0 to avoid disappearing when far away
const DENSITY_VERT = injectToken(
  POINTS_VERT_BASE,
  "__POINT_SIZE__",
  "max(14.0 / -mvPos.z, 1.0)", // larger points for density shader to make clusters more visible; minimum size of 1.0 to avoid disappearing when far away
  "DENSITY_VERT",
); // larger points for density shader

// Shadow vertex shader also uses the conversions library
const SHADOW_VERT = injectToken(
  getShaderSource("shadowVertexShader"),
  "__SHADER_CONVERSIONS__",
  CONVERSIONS_SRC,
  "shadowVertexShader",
);

// ============================================================================
// SCENE HELPERS
// ============================================================================

/** Semi-transparent bounding cube with wireframe edges and grid floor. */
function createBoundingCube(parent) {
  const g = new THREE.Group();
  g.name = "boundingCube";
  const size = 1;
  const offset = new THREE.Vector3(-0.5, 0.25, -0.5); // cube corner at origin, y=0.25 to align with axes and point cloud

  const boxGeometry = new THREE.BoxGeometry(size, size, size);
  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0x888888,
    // just a bounding cube. so transparent and low opcaity.
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false, // prevent writing to depth buffer so it doesn't occlude points
  });
  const box = new THREE.Mesh(boxGeometry, boxMaterial);
  box.position.set(offset.x + 0.5, offset.y + 0.5, offset.z + 0.5); // on the right of the texture plane.
  g.add(box);

  // transparent edges for better cube boundries visibility
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeometry), // extract edges from the box geometry
    new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.5,
    }),
  );
  edges.position.copy(box.position); // align edges with the box
  g.add(edges);

  // grid on the bottom for better depth preception.
  const grid = new THREE.GridHelper(size, 10, 0x666666, 0x444444);
  grid.position.set(offset.x + 0.5, offset.y, offset.z + 0.5); // align grid with the bottom face of the cube
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  g.add(grid);

  parent.add(g); // add the whole cube group to the parent
  return g;
}

// Axes labels
function createTextSprite(text, color) {
  const cv = document.createElement("canvas");
  cv.height = 32;
  const ctx = cv.getContext("2d");
  ctx.font = "bold 20px Arial";

  // width depends on text length, with some padding
  cv.width = Math.max(Math.ceil(ctx.measureText(text).width) + 16, 32);
  ctx.font = "bold 20px Arial"; // re-apply after resize wipes state
  ctx.fillStyle = `#${color.getHexString()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cv.width / 2, 16);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv),
      transparent: true,
    }),
  );
  // Keep height constant while scaling width proportionally.
  sprite.scale.set((0.05 * cv.width) / cv.height, 0.05, 1); //width, hight, depth (depth doesn't matter for sprites)
  return sprite;
}

// Cylinderical axes
function makeGradientAxis(colorStart, colorEnd) {
  const geometry = new THREE.CylinderGeometry(0.008, 0.008, 1.0, 8);
  const pos = geometry.attributes.position; // access vertex positions to determine gradient along the axis
  const cols = new Float32Array(pos.count * 3); // create 3 color positions per vertex for each channel(axes)

  // gradient colors for each axis
  const cs = new THREE.Color(colorStart);
  const ce = new THREE.Color(colorEnd);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5; // −0.5 -> +0.5  mapped to  0 -> 1
    tmp.lerpColors(cs, ce, t); // interpolate color between start and end based on t

    // cols[i*3]= first channel (R)
    // cols[i*3+1]= second channel (G)
    // cols[i*3+2]= third channel (B)
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geometry;
}

function createAxes(parent, csKey) {
  const g = new THREE.Group();
  g.name = "colorSpaceAxes";
  const cfg = COLOR_SPACES[csKey];
  // Corner origin for spaces where values run 0→1 (RGB, HSV, CIEXYZ, CIExyY).
  const orig = new THREE.Vector3(-0.5, 0.25, -0.5);
  // Geometric cube centre for symmetric spaces (CIELAB, CIELCH) where axes cross at 0.
  const cubeCenter = new THREE.Vector3(0, 0.75, 0);
  const dirs = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];

  // Rotate axes so they align with the cube edges regardless of their order in cfg.axes.
  const rots = [
    new THREE.Quaternion().setFromAxisAngle(
      // rotate first axis to align with cube X (right)
      new THREE.Vector3(0, 0, 1),
      -Math.PI / 2,
    ),
    new THREE.Quaternion(), // second axis is already aligned with cube Y (up), so no rotation needed
    new THREE.Quaternion().setFromAxisAngle(
      // rotate third axis to align with cube Z (forward)
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ),
  ];

  cfg.axes.forEach((ax, i) => {
    const labelCol = new THREE.Color(ax.colorEnd); // use the end color for labels
    const cyl = new THREE.Mesh(
      makeGradientAxis(ax.colorStart, ax.colorEnd),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
    );

    let cylPos, lblPos;
    if (cfg.centered) {
      // All three axes cross at the cube centre so labels sit just past the +ve cube wall.
      cylPos = cubeCenter.clone();

      // Position labels slightly beyond the cube edge in the direction of the axis.
      lblPos = cubeCenter.clone().add(dirs[i].clone().multiplyScalar(0.58));
    } else {
      // Axes start from the minimum corner of the cube.
      cylPos = orig.clone().add(dirs[i].clone().multiplyScalar(0.5)); // position the cylinder **Center** halfway along the axis from the corner
      lblPos = orig.clone().add(dirs[i].clone().multiplyScalar(1.08)); // position labels slightly beyond the cube edge in the direction of the axis
    }

    cyl.position.copy(cylPos);
    cyl.quaternion.copy(rots[i]); // rotate cylinder to align with the correct cube edge
    g.add(cyl);

    const lbl = createTextSprite(ax.name, labelCol);
    lbl.position.copy(lblPos);
    g.add(lbl);
  });

  parent.add(g); // add the whole axes group to the parent
  return g;
}

//Removes old axes from parent and creates new ones
function updateAxes(parent, csKey) {
  const old = parent.getObjectByName("colorSpaceAxes");
  if (old) {
    parent.remove(old);
    old.traverse((c) => {
      //dispose geometries and materials to free GPU memory
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    });
  }
  return createAxes(parent, csKey); //recreate axes
}

// ============================================================================
// MEDIA HELPERS
// ============================================================================

/**
 * Reads pixels from a decoded HTMLImageElement and returns a Float32 DataTexture.
 * Storing as Float32 bypasses WebGL's hardware sRGB decode path — the shader
 * receives the raw sRGB values (0–1) directly, which is what all CIE conversions expect.
 */
function buildDataTexture(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0); // image, x, y

  const pixels = context.getImageData(0, 0, image.width, image.height).data; //px is a Uint8ClampedArray: [R0,G0,B0,A0, R1,G1,B1,A1, ...]  (0–255 each)
  const data = new Float32Array(image.width * image.height * 4); // *4 for RGBA channels
  for (let i = 0; i < image.width * image.height; i++) {
    data[i * 4] = pixels[i * 4] / 255; // R channel normalized
    data[i * 4 + 1] = pixels[i * 4 + 1] / 255; // G channel normalized
    data[i * 4 + 2] = pixels[i * 4 + 2] / 255; // B channel normalized
    data[i * 4 + 3] = 1.0; // A channel set to 1.0 (fully opaque)
  }

  const texture = new THREE.DataTexture(
    data,
    image.width,
    image.height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true; // mark texture for upload to GPU
  return texture;
}

async function loadImageSource(path) {
  const displayTex = await new THREE.TextureLoader().loadAsync(path);
  // NoColorSpace: prevents WebGL hardware sRGB decode — shader receives raw 0-1 sRGB bytes.
  // Reuse the same UInt8 texture as shaderTex: avoids a second 16 MB Float32 GPU upload
  // and the JS heap allocation that buildDataTexture would create. The shader gets identical
  // [0-1] values either way since the JPEG source is 8-bit.
  displayTex.colorSpace = THREE.NoColorSpace;
  return { displayTex, shaderTex: displayTex };
}

// ============================================================================
// VIDEO SOURCE HELPER
// ============================================================================

async function loadVideoSource(path) {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous"; // for CORS issues
  video.src = path;

  // await till metadata is loaded
  await new Promise((resolve) =>
    video.addEventListener("loadedmetadata", resolve, { once: true }),
  );
  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.NoColorSpace; // to pass raw sRGB bytes to shader, same as image path.
  // safe video play after metaadata loaded and audio muted
  await video.play();

  return { displayTex: videoTex, shaderTex: videoTex, videoEl: video }; //display texture , shader texture and video element for later use if needed (e.g. to pause/play from GUI)
}

// ============================================================================
// POINT GEOMETRY HELPER
// ============================================================================

/**
 * Builds a BufferGeometry with a `gridUV` attribute whose values are the
 * normalised UV coordinates of every sampled pixel.
 * A dummy `position` attribute is required by Three.js even though all actual
 * positions are computed in the vertex shader.
 */
function buildPointGeometry(imgW, imgH, subsample) {
  const w = Math.ceil(imgW / subsample);
  const h = Math.ceil(imgH / subsample);
  const n = w * h; // total points

  const uvs = new Float32Array(n * 2); //*2 for UV pairs
  let idx = 0;

  // Iterate over the image dimensions with the given subsample step, filling the UV array with normalised coordinates.
  for (let x = 0; x < imgW; x += subsample) {
    for (let y = 0; y < imgH; y += subsample) {
      uvs[idx * 2] = (x + 0.5) / imgW; // normalised U coordinate (0–1 across the width of the image)
      uvs[idx * 2 + 1] = (y + 0.5) / imgH; // normalised V coordinate (0–1 across the height of the image)
      //+0.5 for sampling the pixel center.
      idx++;
    }
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute(
    "gridUV",
    new THREE.Float32BufferAttribute(uvs, 2),
  );
  pointGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3), // computer in shaders later.
  );
  return pointGeometry;
}

// ============================================================================
// GUI
// ============================================================================

function createGUI(app) {
  const gui = new GUI({ title: "Point Cloud Controls" });

  const params = {
    colorSpace: "sRGB",
    visualMode: "direct",
    showShadows: true,
    subsample: 1,
  };

  // Color space selector
  gui
    .add(params, "colorSpace", Object.keys(COLOR_SPACES))
    .name("Color Space")
    .onChange((v) => {
      const cfg = COLOR_SPACES[v];
      if (app.pointsUniforms)
        app.pointsUniforms.colorSpaceMode.value = cfg.shaderMode; // sync shader uniform to switch position mapping in the vertex shader
      if (app.shadowUniforms)
        app.shadowUniforms.colorSpaceMode.value = cfg.shaderMode;
      if (app.densityUniforms)
        app.densityUniforms.colorSpaceMode.value = cfg.shaderMode;
      updateAxes(app.colorSpaceGroup, v);
    });

  // Visual mode selector
  gui
    .add(params, "visualMode", ["direct", "density"])
    .name("Visual Mode")
    .onChange((v) => {
      const directCloud = app.colorSpaceGroup.getObjectByName("pointCloud");
      const densityCloud =
        app.colorSpaceGroup.getObjectByName("pointCloudDensity");
      const shadowCloud =
        app.colorSpaceGroup.getObjectByName("pointCloudShadow");

      if (directCloud) directCloud.visible = v === "direct";
      if (densityCloud) densityCloud.visible = v === "density";
      if (shadowCloud) shadowCloud.visible = params.showShadows;
    });

  gui
    .add(params, "showShadows")
    .name("Show Shadows")
    .onChange((v) => {
      const shadow = app.colorSpaceGroup.getObjectByName("pointCloudShadow");
      if (shadow) shadow.visible = v && params.visualMode === "direct";
    });

  gui
    .add(params, "subsample", 1, 8, 1)
    .name("Subsample (1/n pixels)") // 1 means every pixel, 2 means every other pixel, etc.
    .onChange((v) => {
      const directCloud = app.colorSpaceGroup.getObjectByName("pointCloud");
      const densityCloud =
        app.colorSpaceGroup.getObjectByName("pointCloudDensity");

      // rebuild direct geometry at the new subsample step
      if (directCloud) {
        directCloud.geometry.dispose();
        directCloud.geometry = buildPointGeometry(app.sourceW, app.sourceH, v);
      }

      // density uses its own multiplier on top of the user subsample
      if (densityCloud) {
        const densitySub = Math.max(1, Math.ceil(v / DENSITY_SUBSAMPLE_MULTI));
        densityCloud.geometry.dispose();
        densityCloud.geometry = buildPointGeometry(
          app.sourceW,
          app.sourceH,
          densitySub,
        );
      }
    });

  // Source selector
  const srcParams = { source: "image" };
  gui
    .add(srcParams, "source", ["image", "video"])
    .name("Source")
    .onChange(async (v) => {
      let displayTex, shaderTex, w, h;
      if (v === "video") {
        const metadata = await loadVideoSource(VIDEO_PATH);
        displayTex = metadata.displayTex;
        shaderTex = metadata.shaderTex;
        w = metadata.videoEl.videoWidth;
        h = metadata.videoEl.videoHeight;
      } else {
        const res = await loadImageSource(IMAGE_PATH);
        displayTex = res.displayTex;
        shaderTex = res.shaderTex;
        w = displayTex.image.naturalWidth || displayTex.image.width;
        h = displayTex.image.naturalHeight || displayTex.image.height;
      }

      const planeMesh = app.scene.getObjectByName("displayPlane");
      if (planeMesh) planeMesh.material.uniforms.tex.value = displayTex;

      if (app.pointsUniforms) app.pointsUniforms.pointsTex.value = shaderTex;
      if (app.densityUniforms) app.densityUniforms.pointsTex.value = shaderTex;
      if (app.shadowUniforms) app.shadowUniforms.pointsTex.value = shaderTex;

      if (w !== app.sourceW || h !== app.sourceH) {
        app.sourceW = w;
        app.sourceH = h;
        const dSub = Math.ceil(SUBSAMPLE_FACTOR / DENSITY_SUBSAMPLE_MULTI);
        const dc = app.colorSpaceGroup.getObjectByName("pointCloud");
        const dn = app.colorSpaceGroup.getObjectByName("pointCloudDensity");
        const sh = app.colorSpaceGroup.getObjectByName("pointCloudShadow");
        if (dc) dc.geometry = buildPointGeometry(w, h, SUBSAMPLE_FACTOR);
        if (dn) dn.geometry = buildPointGeometry(w, h, dSub);
        if (sh)
          sh.geometry = buildPointGeometry(
            w,
            h,
            SUBSAMPLE_FACTOR * SHADOW_SUBSAMPLE_MULTI,
          );
        if (app.pointsUniforms) app.pointsUniforms.texSize.value.set(w, h);
        if (app.densityUniforms) app.densityUniforms.texSize.value.set(w, h);
      }
    });

  return gui;
}

// ============================================================================
// EXERCISE 1 INIT
// ============================================================================

export async function initExercise1() {
  const container = document.getElementById("container");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(0, 0.75, 3);
  camera.lookAt(0, 0.75, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement); // attach the canvas to the DOM

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.75, 0);
  controls.update();

  // Load image: displayTex for the plane, shaderTex for the point-cloud shaders
  const { displayTex, shaderTex } = await loadImageSource(IMAGE_PATH);

  // Flat texture display plane (left side)
  const planeMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: displayTex } },
    vertexShader: TEX_VERT,
    fragmentShader: TEX_FRAG,
    side: THREE.DoubleSide, // show texture on both sides of the plane
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), planeMat);
  plane.name = "displayPlane";
  plane.position.set(-0.75, 0.75, 0); // vertical facing the camera
  scene.add(plane);

  // Color-space group (right side)
  const colorSpaceGroup = new THREE.Group();
  colorSpaceGroup.position.x = 0.75; // move to the right of the plane
  scene.add(colorSpaceGroup);

  //some browsers don't populate naturalWidth/Height until the image is fully loaded, so fall back to width/height
  const imgW = displayTex.image.naturalWidth || displayTex.image.width;
  const imgH = displayTex.image.naturalHeight || displayTex.image.height;
  const csMode = 0; // RGB default (shaderMode 0)

  const pointsUniforms = {
    pointsTex: { value: shaderTex },
    texSize: { value: new THREE.Vector2(imgW, imgH) },
    colorSpaceMode: { value: csMode },
  };

  const directMat = new THREE.ShaderMaterial({
    uniforms: pointsUniforms,
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: false, // opaque cloud
    depthWrite: true, // write to depth buffer so points occlude cube walls
  });

  const directCloud = new THREE.Points(
    buildPointGeometry(imgW, imgH, SUBSAMPLE_FACTOR),
    directMat,
  );

  directCloud.name = "pointCloud";
  directCloud.visible = true;
  directCloud.frustumCulled = false; // disable frustum culling to prevent cloud from disappearing at certain angles

  colorSpaceGroup.add(directCloud); // add the direct cloud to the color space group on the right side

  // Density point cloud
  const densitySub = Math.ceil(SUBSAMPLE_FACTOR / DENSITY_SUBSAMPLE_MULTI);
  const densityGeometry = buildPointGeometry(imgW, imgH, densitySub);

  const densityUniforms = {
    pointsTex: { value: shaderTex },
    texSize: { value: new THREE.Vector2(imgW, imgH) },
    colorSpaceMode: { value: csMode },
  };

  const densityMaterial = new THREE.ShaderMaterial({
    uniforms: densityUniforms,
    vertexShader: DENSITY_VERT, // larger points
    fragmentShader: DENSITY_FRAG, //linear splat shader
    transparent: true, // additive blending relies on transparency
    depthWrite: false, // turn off depth buffer writes so points don't occlude each other
    blending: THREE.AdditiveBlending, // additive blending for glow effect in dense regions
  });

  const densityCloud = new THREE.Points(densityGeometry, densityMaterial);
  densityCloud.name = "pointCloudDensity";
  densityCloud.visible = false; // hidden at first by default
  densityCloud.frustumCulled = false; // disable frustum culling to prevent disappearing at certain angles

  colorSpaceGroup.add(densityCloud);

  // Points shadow
  const shadowSub = SUBSAMPLE_FACTOR * SHADOW_SUBSAMPLE_MULTI;

  const shadowUniforms = {
    pointsTex: { value: shaderTex },
    colorSpaceMode: { value: csMode },
    shadowY: { value: 0.251 }, // just above the bounding cube floor
  };

  const shadowCloud = new THREE.Points(
    buildPointGeometry(imgW, imgH, shadowSub),
    new THREE.ShaderMaterial({
      uniforms: shadowUniforms,
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false, // prevent shadows from occluding each other and the cube walls
      blending: THREE.MultiplyBlending,
    }),
  );
  shadowCloud.name = "pointCloudShadow";
  shadowCloud.renderOrder = -1; // draw before main cloud to avoid z-fighting
  shadowCloud.frustumCulled = false;
  shadowCloud.visible = true; // visible by default
  colorSpaceGroup.add(shadowCloud);

  // ----- Bounding cube and axes ------------------------------------------
  createBoundingCube(colorSpaceGroup);
  createAxes(colorSpaceGroup, "sRGB");

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const app = {
    scene,
    camera,
    renderer,
    controls,
    colorSpaceGroup,
    pointsUniforms,
    densityUniforms,
    shadowUniforms,
    sourceW: imgW,
    sourceH: imgH,
    startTime: Date.now(),
  };

  createGUI(app);
  return app;
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================

export function animateExercise1(app) {
  function animate() {
    requestAnimationFrame(animate);
    app.controls.update();
    app.renderer.render(app.scene, app.camera);
  }
  animate();
}
