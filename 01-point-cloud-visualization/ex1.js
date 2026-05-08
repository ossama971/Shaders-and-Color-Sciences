import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { createXRCompatibleRenderer, setupXRExperience } from "../xr_support.js";

const IMAGE_PATH = "../assets/grenouille.jpg";
const VIDEO_PATH = "../assets/video-lowQ.mp4";

const SUBSAMPLE_FACTOR = 2;
const SHADOW_SUBSAMPLE_MULTI = 2;

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
    positionMapping: { x: "a*", y: "L*", z: "b*" },
    shaderMode: 4,
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
  },
};

// Reads a shader block from the HTML by id.
function getShaderSource(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing shader element #${id} in the html file`);
  return el.textContent.trim();
}

// Read raw sources from HTML blocks
const CONVERSIONS_SRC = getShaderSource("shaderConversions"); // convert in GLSL for faster GPU execution especially for video mode
const TEX_VERT = getShaderSource("texVertexShader");
const TEX_FRAG = getShaderSource("texFragmentShader");
const CLOUD_FRAG = getShaderSource("cloudFragmentShader");
const SHADOW_FRAG = getShaderSource("shadowFragmentShader");

// append the shared conversion functions to both vertex shaders
const CLOUD_VERT =
  CONVERSIONS_SRC + "\n" + getShaderSource("cloudVertexShader");
const SHADOW_VERT =
  CONVERSIONS_SRC + "\n" + getShaderSource("shadowVertexShader");

// Semi transparent bounding cube with wireframe edges and grid floor.
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

    // Axes start from the minimum corner of the cube.
    const cylPos = orig.clone().add(dirs[i].clone().multiplyScalar(0.5)); // position the cylinder **Center** halfway along the axis from the corner
    const lblPos = orig.clone().add(dirs[i].clone().multiplyScalar(1.08)); // position labels slightly beyond the cube edge in the direction of the axis

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

// image loader
async function loadImageSource(path) {
  const displayTex = await new THREE.TextureLoader().loadAsync(path);
  // NoColorSpace: prevents WebGL hardware sRGB decode — shader receives raw 0-1 sRGB bytes.
  displayTex.colorSpace = THREE.NoColorSpace;
  return { displayTex, shaderTex: displayTex };
}

// video loader
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

// Shared source-switch logic used by both the desktop GUI and the XR panel.
async function switchSource(app, toVideo) {
  let displayTex, shaderTex, w, h;
  if (toVideo) {
    const meta = await loadVideoSource(VIDEO_PATH);
    displayTex = meta.displayTex;
    shaderTex = meta.shaderTex;
    app.videoEl = meta.videoEl;
    w = meta.videoEl.videoWidth;
    h = meta.videoEl.videoHeight;
  } else {
    if (app.videoEl) { app.videoEl.pause(); app.videoEl = null; }
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
    app.sourceW = w; app.sourceH = h;
    const dc = app.colorSpaceGroup.getObjectByName("pointCloud");
    const dn = app.colorSpaceGroup.getObjectByName("pointCloudDensity");
    const sh = app.colorSpaceGroup.getObjectByName("pointCloudShadow");
    if (dc) { dc.geometry.dispose(); dc.geometry = buildPointGeometry(w, h, SUBSAMPLE_FACTOR); }
    if (dn) { dn.geometry.dispose(); dn.geometry = buildPointGeometry(w, h, SUBSAMPLE_FACTOR); }
    if (sh) { sh.geometry.dispose(); sh.geometry = buildPointGeometry(w, h, SUBSAMPLE_FACTOR * SHADOW_SUBSAMPLE_MULTI); }
    if (app.pointsUniforms) app.pointsUniforms.texSize.value.set(w, h);
    if (app.densityUniforms) app.densityUniforms.texSize.value.set(w, h);
  }
}

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

// XR-only 3-button control panel (color space / visual mode / source).
// Positioned below and centered between the image plane and point cloud.
// Visible only when an XR session is active.
function createXRControlPanel(app) {
  const group = new THREE.Group();
  group.name = "xrControlPanel";
  group.visible = false;
  // x=0 centers between image (-0.75) and cloud group (+0.75)
  // y=0.08 sits just below the bounding cube floor (y=0.25)
  // z=0.18 brings it slightly in front of the scene so it reads cleanly
  group.position.set(0, 0.08, 0.18);

  const colorSpaceKeys = Object.keys(COLOR_SPACES);
  const ps = { csIdx: 0, mode: "direct", source: "image" };

  // Canvas-texture button factory
  function makeBtn(label, getVal, onPress) {
    const CW = 512, CH = 148;
    const canvas = document.createElement("canvas");
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.115), mat);
    let hov = false;

    function draw() {
      ctx.clearRect(0, 0, CW, CH);
      const r = 24;
      // Rounded-rect background
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(CW - r, 0); ctx.quadraticCurveTo(CW, 0, CW, r);
      ctx.lineTo(CW, CH - r); ctx.quadraticCurveTo(CW, CH, CW - r, CH);
      ctx.lineTo(r, CH); ctx.quadraticCurveTo(0, CH, 0, CH - r);
      ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.closePath();
      ctx.fillStyle = hov ? "rgba(60,130,255,0.58)" : "rgba(8,10,22,0.82)";
      ctx.fill();
      ctx.strokeStyle = hov ? "rgba(140,200,255,1.0)" : "rgba(70,110,200,0.42)";
      ctx.lineWidth = hov ? 5 : 3;
      ctx.stroke();
      // Small label at top
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(150,190,255,0.62)";
      ctx.font = "bold 22px Arial";
      ctx.fillText(label, CW / 2, CH * 0.27);
      // Current-value text at bottom
      ctx.fillStyle = hov ? "#ffffff" : "#b0d4ff";
      ctx.font = "bold 38px Arial";
      ctx.fillText(getVal(), CW / 2, CH * 0.68);
      texture.needsUpdate = true;
    }
    draw();

    return {
      mesh,
      setHovered(v) { hov = v; draw(); },
      press() { onPress(); draw(); },
    };
  }

  const SPACING = 0.445;

  const csBtn = makeBtn(
    "COLOR SPACE",
    () => colorSpaceKeys[ps.csIdx],
    () => {
      ps.csIdx = (ps.csIdx + 1) % colorSpaceKeys.length;
      const key = colorSpaceKeys[ps.csIdx];
      const cfg = COLOR_SPACES[key];
      if (app.pointsUniforms) app.pointsUniforms.colorSpaceMode.value = cfg.shaderMode;
      if (app.shadowUniforms) app.shadowUniforms.colorSpaceMode.value = cfg.shaderMode;
      if (app.densityUniforms) app.densityUniforms.colorSpaceMode.value = cfg.shaderMode;
      updateAxes(app.colorSpaceGroup, key);
    }
  );
  csBtn.mesh.position.set(-SPACING, 0, 0);

  const modeBtn = makeBtn(
    "VISUAL MODE",
    () => (ps.mode === "direct" ? "DIRECT" : "DENSITY"),
    () => {
      ps.mode = ps.mode === "direct" ? "density" : "direct";
      const dc = app.colorSpaceGroup.getObjectByName("pointCloud");
      const dn = app.colorSpaceGroup.getObjectByName("pointCloudDensity");
      if (dc) dc.visible = ps.mode === "direct";
      if (dn) dn.visible = ps.mode === "density";
    }
  );
  modeBtn.mesh.position.set(0, 0, 0);

  const srcBtn = makeBtn(
    "SOURCE",
    () => ps.source.toUpperCase(),
    async () => {
      ps.source = ps.source === "image" ? "video" : "image";
      await switchSource(app, ps.source === "video");
    }
  );
  srcBtn.mesh.position.set(SPACING, 0, 0);

  group.add(csBtn.mesh, modeBtn.mesh, srcBtn.mesh);

  const btnList = [csBtn, modeBtn, srcBtn];
  const meshList = btnList.map((b) => b.mesh);
  const hovered = new Map(btnList.map((b) => [b, false]));

  // Declared early so they're in scope for the selectstart handlers below.
  const raycaster = new THREE.Raycaster();
  const tempMtx = new THREE.Matrix4();
  const tipPos = new THREE.Vector3();
  const btnPos = new THREE.Vector3();
  const HAND_HOVER_RADIUS = 0.06;

  // Fresh raycast at press time — avoids any timing dependency on the hover map.
  // Works for both physical trigger (controller) and pinch (hand), since both
  // fire selectstart on the same controller object.
  function pressRay(ctrl) {
    tempMtx.identity().extractRotation(ctrl.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMtx).normalize();
    const hits = raycaster.intersectObjects(meshList, false);
    if (hits.length > 0) {
      const idx = meshList.indexOf(hits[0].object);
      if (idx !== -1) btnList[idx].press();
    }
  }

  // Shared red ray geometry — child of each controller, follows pose automatically.
  const rayGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -3),
  ]);
  const rayMat = new THREE.LineBasicMaterial({ color: 0xff2222 });

  // Controllers must be in the scene for Three.js to update matrixWorld each frame.
  const controllers = [0, 1].map((i) => {
    const ctrl = app.renderer.xr.getController(i);
    app.scene.add(ctrl);
    ctrl.add(new THREE.Line(rayGeom, rayMat));
    ctrl.addEventListener("selectstart", () => pressRay(ctrl));
    return ctrl;
  });

  // Hands in scene so joint matrixWorld values are updated each frame.
  const hands = [0, 1].map((i) => {
    const hand = app.renderer.xr.getHand(i);
    app.scene.add(hand);
    return hand;
  });

  // Called every frame from the animation loop.
  app._xrUpdatePanel = function () {
    if (!group.visible) return;
    const next = new Map(btnList.map((b) => [b, false]));

    // Controller ray hover
    controllers.forEach((ctrl) => {
      tempMtx.identity().extractRotation(ctrl.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMtx).normalize();
      const hits = raycaster.intersectObjects(meshList, false);
      if (hits.length > 0) {
        const idx = meshList.indexOf(hits[0].object);
        if (idx !== -1) next.set(btnList[idx], true);
      }
    });

    // Hand index-finger-tip proximity hover
    hands.forEach((hand) => {
      const indexTip = hand.joints?.["index-finger-tip"];
      if (!indexTip) return;
      indexTip.getWorldPosition(tipPos);
      meshList.forEach((mesh, idx) => {
        mesh.getWorldPosition(btnPos);
        if (tipPos.distanceTo(btnPos) < HAND_HOVER_RADIUS) next.set(btnList[idx], true);
      });
    });

    btnList.forEach((b) => {
      const was = hovered.get(b), is = next.get(b);
      if (was !== is) { hovered.set(b, is); b.setHovered(is); }
    });
  };

  return group;
}

function createGUI(app) {
  const gui = new GUI({ title: "Point Cloud Controls" });

  const params = {
    colorSpace: "sRGB",
    visualMode: "direct",
    showShadows: true,
    subsample: SUBSAMPLE_FACTOR,
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
      if (shadow) shadow.visible = v;
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

      if (densityCloud) {
        densityCloud.geometry.dispose();
        densityCloud.geometry = buildPointGeometry(app.sourceW, app.sourceH, v);
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
        app.videoEl = metadata.videoEl;
        w = metadata.videoEl.videoWidth;
        h = metadata.videoEl.videoHeight;
      } else {
        // default to image
        if (app.videoEl) {
          app.videoEl.pause();
          app.videoEl = null; // disable video elements
        }
        const res = await loadImageSource(IMAGE_PATH);
        displayTex = res.displayTex;
        shaderTex = res.shaderTex;
        w = displayTex.image.naturalWidth || displayTex.image.width;
        h = displayTex.image.naturalHeight || displayTex.image.height;
      }

      const planeMesh = app.scene.getObjectByName("displayPlane");
      if (planeMesh) planeMesh.material.uniforms.tex.value = displayTex;

      // update shader texture uniforms for all point clouds
      if (app.pointsUniforms) app.pointsUniforms.pointsTex.value = shaderTex;
      if (app.densityUniforms) app.densityUniforms.pointsTex.value = shaderTex;
      if (app.shadowUniforms) app.shadowUniforms.pointsTex.value = shaderTex;

      // Only rebuild geometries if the source dimensions have changed
      // to avoid unnecessary GPU uploads when switching between sources of the same size
      if (w !== app.sourceW || h !== app.sourceH) {
        app.sourceW = w;
        app.sourceH = h;
        const dc = app.colorSpaceGroup.getObjectByName("pointCloud");
        const dn = app.colorSpaceGroup.getObjectByName("pointCloudDensity");
        const sh = app.colorSpaceGroup.getObjectByName("pointCloudShadow");
        if (dc) dc.geometry = buildPointGeometry(w, h, SUBSAMPLE_FACTOR);
        if (dn) dn.geometry = buildPointGeometry(w, h, SUBSAMPLE_FACTOR);
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

  const videoControls = {
    playPause() {
      if (!app.videoEl) return; // no video loaded, do nothing (image mode)
      app.videoEl.paused ? app.videoEl.play() : app.videoEl.pause();
    },
    seekBack() {
      if (app.videoEl)
        app.videoEl.currentTime = Math.max(0, app.videoEl.currentTime - 10);
    },
    seekForward() {
      if (app.videoEl)
        app.videoEl.currentTime = Math.min(
          app.videoEl.duration,
          app.videoEl.currentTime + 10,
        );
    },
  };
  gui.add(videoControls, "seekBack").name("◀◀ -10s");
  gui.add(videoControls, "playPause").name("⏯ Play / Pause");
  gui.add(videoControls, "seekForward").name("▶▶ +10s");

  return gui;
}

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

  const renderer = createXRCompatibleRenderer({ antialias: true, alpha: true });
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
    pointSizeBase: { value: 6.0 },
    renderMode: { value: 0 },
  };

  const directMat = new THREE.ShaderMaterial({
    uniforms: pointsUniforms,
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: false,
    depthWrite: true,
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
  const densityGeometry = buildPointGeometry(imgW, imgH, SUBSAMPLE_FACTOR);

  const densityUniforms = {
    pointsTex: { value: shaderTex },
    texSize: { value: new THREE.Vector2(imgW, imgH) },
    colorSpaceMode: { value: csMode },
    pointSizeBase: { value: 14.0 },
    renderMode: { value: 1 },
  };

  const densityMaterial = new THREE.ShaderMaterial({
    uniforms: densityUniforms,
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
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
      premultipliedAlpha: true,
    }),
  );
  shadowCloud.name = "pointCloudShadow";
  shadowCloud.renderOrder = -1; // draw before main cloud to avoid z-fighting
  shadowCloud.frustumCulled = false;
  shadowCloud.visible = true; // visible by default
  colorSpaceGroup.add(shadowCloud);

  // Bounding cube and axes
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
    videoEl: null,
  };

  Object.assign(
    app,
    setupXRExperience({
      scene,
      camera,
      renderer,
      controls,
      title: "Exercise 1",
      description: "Explore color-space point clouds in VR and AR.",
      arWorldYOffset: -0.25,
      xrWorldZOffset: -2.25,
    }),
  );

  createGUI(app);

  // XR-only control panel — added to worldRoot so it inherits XR world placement
  const xrPanel = createXRControlPanel(app);
  app.worldRoot.add(xrPanel);
  renderer.xr.addEventListener("sessionstart", () => { xrPanel.visible = true; });
  renderer.xr.addEventListener("sessionend", () => { xrPanel.visible = false; });

  return app;
}

export function animateExercise1(app) {
  app.renderer.setAnimationLoop(() => {
    if (!app.renderer.xr.isPresenting) {
      app.controls.update();
    }
    if (app._xrUpdatePanel) app._xrUpdatePanel();
    app.renderer.render(app.scene, app.camera);
  });
}
