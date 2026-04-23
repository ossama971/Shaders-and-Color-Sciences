/**
 * ex1_solution.js — Exercise 1: Color-Space Point-Cloud Visualization
 *
 * INTENDED USE
 * ------------
 * This is the self-assessment reference for ex1_hints.js.
 * Open it only when you are genuinely blocked on a specific TODO.
 * After reading the relevant section, close it and re-implement from your
 * own understanding — do NOT copy-paste into your hints file.
 *
 * WHAT IS IMPLEMENTED
 * -------------------
 * All 17 TODOs: 6 conversion functions, 4 position mappings,
 * the density fragment shader, the density cloud object, the visual mode GUI,
 * loadVideoSource, and the source selector GUI.
 *
 * This file is fully self-contained: shader strings live here as JS template
 * literals and are NOT read from HTML blocks.
 *
 * Asset path is relative to this file's location (served from the same directory).
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

const IMAGE_URL = "./Assests/grenouille.jpg";
const VIDEO_URL = "./Assests/video.mp4";

// ============================================================================
// PERFORMANCE CONFIGURATION
// ============================================================================

const SUBSAMPLE_FACTOR = 1;
const SHADOW_SUBSAMPLE_MULTI = 4;
const DENSITY_SUBSAMPLE_MULTI = 2;

// ============================================================================
// COLOR SPACE CONFIGURATION
// ============================================================================

const COLOR_SPACES = {
  RGB: {
    name: "RGB",
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
    positionMapping: { x: "x-chroma", y: "Y-luma", z: "y-chroma" },
    shaderMode: 3,
  },
  CIELAB: {
    name: "CIELAB",
    axes: [
      {
        name: "a*",
        colorStart: 0x00cc44,
        colorEnd: 0xff0066,
        range: [-100, 100],
      },
      { name: "L*", colorStart: 0x000000, colorEnd: 0xffffff, range: [0, 100] },
      {
        name: "b*",
        colorStart: 0x0055ff,
        colorEnd: 0xffaa00,
        range: [-100, 100],
      },
    ],
    // Axes run corner-to-corner; a*=0 and b*=0 naturally land at the midpoint (cube centre).
    positionMapping: { x: "a*", y: "L*", z: "b*" },
    shaderMode: 4,
    centered: false,
  },
  CIELCH: {
    name: "CIELCH",
    axes: [
      {
        name: "C*",
        colorStart: 0x777777,
        colorEnd:   0xff5500,
        range: [0, 100],
      },
      { name: "L*", colorStart: 0x000000, colorEnd: 0xffffff, range: [0, 100] },
      {
        name: "H",
        colorStart: 0xff0000,
        colorEnd:   0xcc00ff,
        range: [0, 360],
      },
    ],
    positionMapping: { x: "C*", y: "L*", z: "H" },
    shaderMode: 5,
    centered: false,
  },
};

// ============================================================================
// GLSL CONVERSION LIBRARY
// ============================================================================

const SHADER_CONVERSIONS = /* glsl */ `

  // sRGB to linear: IEC 61966-2-1 piecewise transfer function.
  // mix() + step() applies the formula to all three channels without branching.
  vec3 srgbToLinear(vec3 c) {
    return mix(
      c / 12.92,
      pow((c + 0.055) / 1.055, vec3(2.4)),
      step(vec3(0.04045), c)
    );
  }

  // Linear RGB to CIEXYZ: D65 illuminant matrix.
  // GLSL mat3 is column-major: mat3(col0, col1, col2).
  //   col0 = R contribution to (X, Y, Z)
  //   col1 = G contribution to (X, Y, Z)
  //   col2 = B contribution to (X, Y, Z)
  vec3 rgb2xyz(vec3 rgb) {
    vec3 lin = srgbToLinear(rgb);
    mat3 m = mat3(
      0.4124564, 0.2126729, 0.0193339,  // col 0: R -> XYZ
      0.3575761, 0.7151522, 0.1191920,  // col 1: G -> XYZ
      0.1804375, 0.0721750, 0.9503041   // col 2: B -> XYZ
    );
    return m * lin;
  }

  // CIEXYZ to CIExyY: separate chromaticity (x, y) from luminance (Y).
  // Returns vec3(x-chroma, y-chroma, Y-luminance).
  vec3 xyz2xyY(vec3 xyz) {
    float sum = xyz.x + xyz.y + xyz.z;
    if (sum < 1e-6) return vec3(0.0); // pure black: chromaticity undefined
    return vec3(xyz.x / sum, xyz.y / sum, xyz.y);
  }

  // CIELAB piecewise helper: cube-root with linear near-zero extension.
  // delta = 6/29 ~= 0.2069;  delta^3 ~= 0.00886
  float labF(float t) {
    const float d = 6.0 / 29.0;
    return t > d * d * d
      ? pow(t, 1.0 / 3.0)
      : t / (3.0 * d * d) + 4.0 / 29.0;
  }

  // CIEXYZ to CIELAB: D65 reference white (Xn=0.95047, Yn=1.0, Zn=1.08883).
  // Returns vec3(L*, a*, b*).
  vec3 xyz2lab(vec3 xyz) {
    float fx = labF(xyz.x / 0.95047);
    float fy = labF(xyz.y / 1.00000);
    float fz = labF(xyz.z / 1.08883);
    return vec3(
      116.0 * fy - 16.0,
      500.0 * (fx - fy),
      200.0 * (fy - fz)
    );
  }

  // CIELAB to CIELCH: cylindrical polar form.
  // Returns vec3(L*, C*, h_normalized) where h_normalized in [0, 1].
  vec3 lab2lch(vec3 lab) {
    float C = length(lab.yz);               // chroma: sqrt(a*^2 + b*^2)
    float h = atan(lab.z, lab.y);           // hue angle: [-pi, pi]
    if (h < 0.0) h += 6.28318530;          // shift to [0, 2pi]
    return vec3(lab.x, C, h / 6.28318530);
  }

  // RGB to HSV (standard formula, PRD §8.6).
  vec3 rgb2hsv(vec3 c) {
    float Cmax  = max(c.r, max(c.g, c.b));
    float Cmin  = min(c.r, min(c.g, c.b));
    float Delta = Cmax - Cmin;

    float V = Cmax;
    float S = (Cmax < 1e-6) ? 0.0 : Delta / Cmax;

    float H = 0.0;
    if (Delta > 1e-6) {
      if      (Cmax == c.r) { H = 60.0 * mod((c.g - c.b) / Delta, 6.0); }
      else if (Cmax == c.g) { H = 60.0 * ((c.b - c.r) / Delta + 2.0);   }
      else                  { H = 60.0 * ((c.r - c.g) / Delta + 4.0);   }
      H /= 360.0; // normalise degrees → [0, 1]
    }

    return vec3(H, S, V);
  }
`;

// ============================================================================
// POINT-CLOUD VERTEX SHADER
// ============================================================================

const POINTS_VERTEX_SHADER = /* glsl */ `
  uniform sampler2D pointsTex;
  uniform vec2      texSize;
  uniform int       colorSpaceMode;
  attribute vec2    gridUV;
  varying vec3      vColor;

  ${SHADER_CONVERSIONS}

  void main() {
    vec3 srgb = texture2D(pointsTex, gridUV).rgb;
    vec3 pos;

    if (colorSpaceMode == 0) {
      pos = vec3(srgb.r - 0.5, srgb.b + 0.25, srgb.g - 0.5);

    } else if (colorSpaceMode == 1) {
      vec3 hsv = rgb2hsv(srgb);
      pos = vec3(hsv.x - 0.5, hsv.z + 0.25, hsv.y - 0.5);

    } else if (colorSpaceMode == 2) {
      vec3 xyz = rgb2xyz(srgb);
      pos = vec3(
        clamp(xyz.x / 0.95047, 0.0, 1.0) - 0.5,
        clamp(xyz.y,            0.0, 1.0) + 0.25,
        clamp(xyz.z / 1.08883, 0.0, 1.0) - 0.5
      );

    } else if (colorSpaceMode == 3) {
      vec3 xyY = xyz2xyY(rgb2xyz(srgb));
      pos = vec3(
        xyY.x - 0.5,   // x-chromaticity
        xyY.z + 0.25,  // Y-luminance (index 2 in our vec3)
        xyY.y - 0.5    // y-chromaticity (index 1 in our vec3)
      );

    } else if (colorSpaceMode == 4) {
      vec3 lab = xyz2lab(rgb2xyz(srgb));
      pos = vec3(
        lab.y / 200.0,                    // a* -> x  (±100 fills ±0.5)
        (lab.x - 50.0) / 100.0 + 0.75,   // L* -> y  (L*=50 at cube centre)
        lab.z / 200.0                     // b* -> z  (±100 fills ±0.5)
      );

    } else {
      vec3 lch = lab2lch(xyz2lab(rgb2xyz(srgb)));
      pos = vec3(
        clamp(lch.y / 100.0, 0.0, 1.0) - 0.5,  // C* → x: grey=left, vivid=right
        lch.x / 100.0 + 0.25,                   // L* → y
        lch.z - 0.5                              // H_norm → z: 0°/360° at edges, 180° at centre
      );
    }

    vColor = srgb;
    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = max(6.0 / -mvPos.z, 1.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

// Density vertex shader: same position logic, larger point sprites.
const DENSITY_VERTEX_SHADER = POINTS_VERTEX_SHADER.replace(
  "gl_PointSize = max(6.0 / -mvPos.z, 1.0);",
  "gl_PointSize = max(14.0 / -mvPos.z, 2.0);",
);

// ============================================================================
// FRAGMENT SHADERS
// ============================================================================

const POINTS_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

const DENSITY_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float weight = exp(-10.0 * dist * dist); // Gaussian falloff; k=10 works well for frog
    gl_FragColor = vec4(vColor * weight, 0.07 * weight); // low alpha: accumulate over many points
  }
`;

const TEX_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const TEX_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tex;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(tex, vUv).rgb, 1.0); }
`;

const SHADOW_VERTEX_SHADER = /* glsl */ `
  uniform sampler2D pointsTex;
  uniform int       colorSpaceMode;
  uniform float     shadowY;
  attribute vec2    gridUV;
  varying float     vAlpha;
  ${SHADER_CONVERSIONS}
  void main() {
    vec3 srgb = texture2D(pointsTex, gridUV).rgb;
    vec3 pos;
    if (colorSpaceMode == 1) {
      vec3 hsv = rgb2hsv(srgb);
      pos = vec3(hsv.x - 0.5, shadowY, hsv.y - 0.5);
      vAlpha = 0.15 * hsv.z;
    } else {
      pos = vec3(srgb.r - 0.5, shadowY, srgb.g - 0.5);
      vAlpha = 0.15 * srgb.b;
    }
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp(3.0 * (120.0 / -mvPos.z), 1.5, 4.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const SHADOW_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha * (1.0 - dist * 2.0));
  }
`;

// ============================================================================
// SCENE HELPERS
// ============================================================================

function createBoundingCube(parent) {
  const g = new THREE.Group();
  g.name = "boundingCube";
  const size = 1;
  const off = new THREE.Vector3(-0.5, 0.25, -0.5);

  const boxGeo = new THREE.BoxGeometry(size, size, size);
  const box = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  box.position.set(off.x + 0.5, off.y + 0.5, off.z + 0.5);
  g.add(box);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.5,
    }),
  );
  edges.position.copy(box.position);
  g.add(edges);

  const grid = new THREE.GridHelper(size, 10, 0x666666, 0x444444);
  grid.position.set(off.x + 0.5, off.y, off.z + 0.5);
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  g.add(grid);

  parent.add(g);
  return g;
}

function createTextSprite(text, color) {
  const cv = document.createElement("canvas");
  cv.height = 32;
  const ctx = cv.getContext("2d");
  ctx.font = "bold 20px Arial";
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
  sprite.scale.set((0.05 * cv.width) / cv.height, 0.05, 1);
  return sprite;
}

function makeGradientAxis(colorStart, colorEnd) {
  const geom = new THREE.CylinderGeometry(0.008, 0.008, 1.0, 8);
  const pos = geom.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cs = new THREE.Color(colorStart);
  const ce = new THREE.Color(colorEnd);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5; // −0.5 → +0.5  mapped to  0 → 1
    tmp.lerpColors(cs, ce, t);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geom;
}

function createAxes(parent, csKey) {
  const g = new THREE.Group();
  g.name = "colorSpaceAxes";
  const cfg = COLOR_SPACES[csKey];
  const orig = new THREE.Vector3(-0.5, 0.25, -0.5); // min corner for 0→1 spaces
  const cubeCenter = new THREE.Vector3(0, 0.75, 0); // geometric centre for ±symmetric spaces
  const dirs = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  const rots = [
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -Math.PI / 2,
    ),
    new THREE.Quaternion(),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ),
  ];

  cfg.axes.forEach((ax, i) => {
    const labelCol = new THREE.Color(ax.colorEnd);
    const cyl = new THREE.Mesh(
      makeGradientAxis(ax.colorStart, ax.colorEnd),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
    );

    const cylPos = cfg.centered
      ? cubeCenter.clone()
      : orig.clone().add(dirs[i].clone().multiplyScalar(0.5));
    const lblPos = cfg.centered
      ? cubeCenter.clone().add(dirs[i].clone().multiplyScalar(0.58))
      : orig.clone().add(dirs[i].clone().multiplyScalar(1.08));

    cyl.position.copy(cylPos);
    cyl.quaternion.copy(rots[i]);
    g.add(cyl);
    const lbl = createTextSprite(ax.name, labelCol);
    lbl.position.copy(lblPos);
    g.add(lbl);
  });

  parent.add(g);
  return g;
}

function updateAxes(parent, csKey) {
  const old = parent.getObjectByName("colorSpaceAxes");
  if (old) {
    parent.remove(old);
    old.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    });
  }
  return createAxes(parent, csKey);
}

// ============================================================================
// MEDIA HELPERS
// ============================================================================

// TODO 1 reference: Extract pixels into Float32 DataTexture
function buildDataTexture(image) {
  const w = image.width;
  const h = image.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    data[p] = px[p] / 255;
    data[p + 1] = px[p + 1] / 255;
    data[p + 2] = px[p + 2] / 255;
    data[p + 3] = 1.0;
  }

  const tex = new THREE.DataTexture(
    data,
    w,
    h,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

async function loadImageSource(url) {
  const displayTex = await new THREE.TextureLoader().loadAsync(url);
  // NoColorSpace: prevents WebGL hardware sRGB decode — shader receives raw 0-1 sRGB bytes.
  // Reuse the same UInt8 texture as shaderTex: avoids a second 16 MB Float32 GPU upload
  // and the JS heap allocation that buildDataTexture would create.
  displayTex.colorSpace = THREE.NoColorSpace;
  return { displayTex, shaderTex: displayTex };
}

// TODO 16 reference: Load a video file as a continuously-updating GPU texture
async function loadVideoSource(path) {
  const video = document.createElement("video");
  video.muted = true; // required for browser autoplay policy
  video.loop = true;
  video.playsInline = true; // avoids full-screen takeover on mobile
  video.crossOrigin = "anonymous";
  video.src = path;

  // Wait until dimensions are known — loadedmetadata fires before any frame decodes
  await new Promise((resolve) =>
    video.addEventListener("loadedmetadata", resolve, { once: true }),
  );

  // VideoTexture wraps an HTMLVideoElement. Three.js checks
  //   video.readyState >= HAVE_CURRENT_DATA before each GPU upload, so the
  //   texture auto-refreshes every render frame with no manual needsUpdate calls.
  const videoTex = new THREE.VideoTexture(video);

  // NoColorSpace: raw sRGB-encoded bytes reach the shader.
  // The srgbToLinear() call in shaderConversions handles linearisation —
  // exactly the same path as the Float32 DataTexture from loadImageSource.
  videoTex.colorSpace = THREE.NoColorSpace;

  await video.play(); // safe to call: video is muted and metadata is loaded

  // Key difference from loadImageSource:
  //   displayTex === shaderTex — both are the same VideoTexture.
  //   There is no separate Float32 DataTexture for video; the VideoTexture
  //   itself is used by both the flat plane and the points vertex shader.
  return { displayTex: videoTex, shaderTex: videoTex, videoEl: video };
}

// ============================================================================
// POINT GEOMETRY
// ============================================================================

// TODO 2 reference: Build UV grid BufferGeometry
function buildPointGeometry(imgW, imgH, subsample) {
  const w = Math.ceil(imgW / subsample);
  const h = Math.ceil(imgH / subsample);
  const n = w * h;

  const uvs = new Float32Array(n * 2);
  let idx = 0;
  for (let y = 0; y < imgH; y += subsample) {
    for (let x = 0; x < imgW; x += subsample) {
      uvs[idx * 2] = (x + 0.5) / imgW;
      uvs[idx * 2 + 1] = (y + 0.5) / imgH;
      idx++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("gridUV", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3),
  );
  return geo;
}

// ============================================================================
// GUI
// ============================================================================

function createGUI(app) {
  const gui = new GUI({ title: "Point Cloud Controls" });

  const params = {
    colorSpace: "RGB",
    visualMode: "direct",
    showShadows: true,
  };

  gui
    .add(params, "colorSpace", Object.keys(COLOR_SPACES))
    .name("Color Space")
    .onChange((v) => {
      const cfg = COLOR_SPACES[v];
      app.pointsUniforms.colorSpaceMode.value = cfg.shaderMode;
      if (app.shadowUniforms)
        app.shadowUniforms.colorSpaceMode.value = cfg.shaderMode;
      if (app.densityUniforms)
        app.densityUniforms.colorSpaceMode.value = cfg.shaderMode;
      updateAxes(app.colorSpaceGroup, v);
    });

  gui
    .add(params, "visualMode", ["direct", "density"])
    .name("Visual Mode")
    .onChange((v) => {
      const dc = app.colorSpaceGroup.getObjectByName("pointCloud");
      const dn = app.colorSpaceGroup.getObjectByName("pointCloudDensity");
      const sh = app.colorSpaceGroup.getObjectByName("pointCloudShadow");
      if (dc) dc.visible = v === "direct";
      if (dn) dn.visible = v === "density";
      if (sh) sh.visible = v === "direct" && params.showShadows;
    });

  gui
    .add(params, "showShadows")
    .name("Show Shadows")
    .onChange((v) => {
      const sh = app.colorSpaceGroup.getObjectByName("pointCloudShadow");
      if (sh) sh.visible = v && params.visualMode === "direct";
    });

  // TODO 17 reference: Source selector — hot-swap between image and video
  const srcParams = { source: "image" };
  gui
    .add(srcParams, "source", ["image", "video"])
    .name("Source")
    .onChange(async (v) => {
      let displayTex, shaderTex, w, h;
      if (v === "video") {
        const res = await loadVideoSource(VIDEO_URL);
        displayTex = res.displayTex;
        shaderTex = res.shaderTex;
        w = res.videoEl.videoWidth;
        h = res.videoEl.videoHeight;
      } else {
        const res = await loadImageSource(IMAGE_URL);
        displayTex = res.displayTex;
        shaderTex = res.shaderTex;
        w = displayTex.image.naturalWidth || displayTex.image.width;
        h = displayTex.image.naturalHeight || displayTex.image.height;
      }

      // Swap flat-plane texture
      const planeMesh = app.scene.getObjectByName("displayPlane");
      if (planeMesh) planeMesh.material.uniforms.tex.value = displayTex;

      // Swap shader texture in all cloud uniforms
      if (app.pointsUniforms) app.pointsUniforms.pointsTex.value = shaderTex;
      if (app.densityUniforms) app.densityUniforms.pointsTex.value = shaderTex;
      if (app.shadowUniforms) app.shadowUniforms.pointsTex.value = shaderTex;

      // Rebuild geometry only when source dimensions change
      if (w !== app.sourceW || h !== app.sourceH) {
        app.sourceW = w;
        app.sourceH = h;
        const dSub = Math.max(
          1,
          Math.ceil(SUBSAMPLE_FACTOR / DENSITY_SUBSAMPLE_MULTI),
        );
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
        // Update texSize uniforms so any shader using them stays in sync
        if (app.pointsUniforms) app.pointsUniforms.texSize.value.set(w, h);
        if (app.densityUniforms) app.densityUniforms.texSize.value.set(w, h);
      }
    });

  return gui;
}

// ============================================================================
// INIT
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
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.75, 0);
  controls.update();

  const { displayTex, shaderTex } = await loadImageSource(IMAGE_URL);

  // Flat display plane — vertical, left side
  const planeMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: displayTex } },
    vertexShader: TEX_VERTEX_SHADER,
    fragmentShader: TEX_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), planeMat);
  plane.name = "displayPlane"; // used by source selector in createGUI
  plane.position.set(-0.75, 0.75, 0);
  scene.add(plane);

  // Color-space group — contains all cloud objects, right side
  const colorSpaceGroup = new THREE.Group();
  colorSpaceGroup.position.x = 0.75;
  scene.add(colorSpaceGroup);

  const imgW = displayTex.image.naturalWidth || displayTex.image.width;
  const imgH = displayTex.image.naturalHeight || displayTex.image.height;
  const csMode = 0; // RGB default (shaderMode 0)

  // TODO 3 reference: Assemble direct cloud
  const pointsUniforms = {
    pointsTex: { value: shaderTex },
    texSize: { value: new THREE.Vector2(imgW, imgH) },
    colorSpaceMode: { value: csMode },
  };
  const directCloud = new THREE.Points(
    buildPointGeometry(imgW, imgH, SUBSAMPLE_FACTOR),
    new THREE.ShaderMaterial({
      uniforms: pointsUniforms,
      vertexShader: POINTS_VERTEX_SHADER,
      fragmentShader: POINTS_FRAGMENT_SHADER,
      transparent: false,
      depthWrite: true,
    }),
  );
  directCloud.name = "pointCloud";
  directCloud.visible = true; // direct mode is the default
  directCloud.frustumCulled = false;
  colorSpaceGroup.add(directCloud);

  // Density cloud
  const densitySub = Math.max(
    1,
    Math.ceil(SUBSAMPLE_FACTOR / DENSITY_SUBSAMPLE_MULTI),
  );
  const densityUniforms = {
    pointsTex: { value: shaderTex },
    texSize: { value: new THREE.Vector2(imgW, imgH) },
    colorSpaceMode: { value: csMode },
  };
  const densityCloud = new THREE.Points(
    buildPointGeometry(imgW, imgH, densitySub),
    new THREE.ShaderMaterial({
      uniforms: densityUniforms,
      vertexShader: DENSITY_VERTEX_SHADER,
      fragmentShader: DENSITY_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  densityCloud.name = "pointCloudDensity";
  densityCloud.visible = false; // hidden by default; GUI toggle switches modes
  densityCloud.frustumCulled = false;
  colorSpaceGroup.add(densityCloud);

  // Shadow cloud
  const shadowUniforms = {
    pointsTex: { value: shaderTex },
    colorSpaceMode: { value: csMode },
    shadowY: { value: 0.251 },
  };
  const shadowCloud = new THREE.Points(
    buildPointGeometry(imgW, imgH, SUBSAMPLE_FACTOR * SHADOW_SUBSAMPLE_MULTI),
    new THREE.ShaderMaterial({
      uniforms: shadowUniforms,
      vertexShader: SHADOW_VERTEX_SHADER,
      fragmentShader: SHADOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
    }),
  );
  shadowCloud.name = "pointCloudShadow";
  shadowCloud.renderOrder = -1;
  shadowCloud.frustumCulled = false;
  shadowCloud.visible = true; // visible by default
  colorSpaceGroup.add(shadowCloud);

  createBoundingCube(colorSpaceGroup);
  createAxes(colorSpaceGroup, "RGB");

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
    sourceW: imgW, // current source width — updated by source selector (TODO 17)
    sourceH: imgH, // current source height
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
