import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

// ============================================================================
// SETTINGS PERSISTENCE
// ============================================================================
// All UI settings are stored in sessionStorage to persist across reloads

function loadSettings() {
  return {
    subsampleFactor: parseInt(
      sessionStorage.getItem("pointcloud_subsample") || "4",
    ),
    shadowEnabled: sessionStorage.getItem("pointcloud_shadow") !== "false",
    colorSpace: sessionStorage.getItem("pointcloud_colorspace") || "RGB",
  };
}

function saveSetting(key, value) {
  sessionStorage.setItem(`pointcloud_${key}`, String(value));
}

const settings = loadSettings();

// ============================================================================
// PERFORMANCE CONFIGURATION
// ============================================================================
// Subsample factor: 1 = full resolution, 2 = every 2nd pixel, 4 = every 4th, etc.
// Higher values = better performance, lower quality
let SUBSAMPLE_FACTOR = settings.subsampleFactor;
let SHADOW_ENABLED = settings.shadowEnabled;
let SHADOW_SUBSAMPLE_MULTIPLIER = 2; // Shadow uses even fewer points

// ============================================================================
// COLOR SPACE CONFIGURATION
// ============================================================================
// Extensible configuration for different color spaces.
// To add a new color space: add an entry with axes, positionMapping, and shaderMode.

const COLOR_SPACES = {
  RGB: {
    name: "RGB",
    axes: [
      { name: "R", color: 0xff0000, range: [0, 1] },
      { name: "G", color: 0x00ff00, range: [0, 1] },
      { name: "B", color: 0x0000ff, range: [0, 1] },
    ],
    // Maps color components to 3D axes (x, y, z)
    positionMapping: { x: "r", y: "b", z: "g" },
    // Shader mode uniform value (0 = RGB, 1 = HSV, etc.)
    shaderMode: 0,
  },
  HSV: {
    name: "HSV",
    axes: [
      { name: "H", color: 0xff0088, range: [0, 1] },
      { name: "S", color: 0xffff00, range: [0, 1] },
      { name: "V", color: 0x00ffff, range: [0, 1] },
    ],
    positionMapping: { x: "h", y: "v", z: "s" },
    shaderMode: 1,
  },
  // Add more color spaces here following the same pattern:
  // LAB: { name: "LAB", axes: [...], positionMapping: {...}, shaderMode: 2 },
};

// Load saved color space or default to RGB
let currentColorSpace = COLOR_SPACES[settings.colorSpace]
  ? settings.colorSpace
  : "RGB";

// ============================================================================
// VISUALIZATION HELPERS
// ============================================================================

/**
 * Creates a semi-transparent bounding cube with wireframe edges and grid floor.
 */
function createBoundingCube(scene) {
  const cubeGroup = new THREE.Group();
  cubeGroup.name = "boundingCube";

  const size = 1;
  const offset = new THREE.Vector3(-0.5, 0.25, -0.5);

  // Semi-transparent faces
  const boxGeometry = new THREE.BoxGeometry(size, size, size);
  const faceMaterial = new THREE.MeshBasicMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const box = new THREE.Mesh(boxGeometry, faceMaterial);
  box.position.set(
    offset.x + size / 2,
    offset.y + size / 2,
    offset.z + size / 2,
  );
  cubeGroup.add(box);

  // Wireframe edges
  const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0xaaaaaa,
    transparent: true,
    opacity: 0.5,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  edges.position.copy(box.position);
  cubeGroup.add(edges);

  // Grid on bottom face
  const gridSize = size;
  const gridDivisions = 10;
  const gridHelper = new THREE.GridHelper(
    gridSize,
    gridDivisions,
    0x666666,
    0x444444,
  );
  gridHelper.position.set(offset.x + size / 2, offset.y, offset.z + size / 2);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.4;
  cubeGroup.add(gridHelper);

  scene.add(cubeGroup);
  return cubeGroup;
}

/**
 * Creates axis cylinders with tick marks and labels for the current color space.
 */
function createAxes(scene, colorSpaceKey) {
  const axesGroup = new THREE.Group();
  axesGroup.name = "colorSpaceAxes";

  const config = COLOR_SPACES[colorSpaceKey];
  const axisLength = 1.0;
  const axisRadius = 0.008;
  const tickCount = 5;
  const tickRadius = 0.004;
  const tickLength = 0.04;
  const origin = new THREE.Vector3(-0.5, 0.25, -0.5);

  // Axis directions: X (right), Y (up), Z (forward)
  const directions = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];

  // Rotation quaternions to orient cylinders along each axis
  const rotations = [
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -Math.PI / 2,
    ), // X axis
    new THREE.Quaternion(), // Y axis (default cylinder orientation)
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ), // Z axis
  ];

  config.axes.forEach((axisConfig, i) => {
    const dir = directions[i];
    const color = new THREE.Color(axisConfig.color);

    // Main axis cylinder
    const cylinderGeometry = new THREE.CylinderGeometry(
      axisRadius,
      axisRadius,
      axisLength,
      8,
    );
    const cylinderMaterial = new THREE.MeshBasicMaterial({ color: color });
    const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);

    // Position at midpoint of axis
    const midpoint = origin
      .clone()
      .add(dir.clone().multiplyScalar(axisLength / 2));
    cylinder.position.copy(midpoint);
    cylinder.quaternion.copy(rotations[i]);
    axesGroup.add(cylinder);

    // Tick marks as small cylinders
    for (let t = 0; t <= tickCount; t++) {
      const tickPos = origin
        .clone()
        .add(dir.clone().multiplyScalar((t / tickCount) * axisLength));

      // Create perpendicular tick cylinders
      const perpDirs = directions.filter((_, idx) => idx !== i);
      const perpRots = rotations.filter((_, idx) => idx !== i);

      perpDirs.forEach((perpDir, pIdx) => {
        const tickGeometry = new THREE.CylinderGeometry(
          tickRadius,
          tickRadius,
          tickLength,
          6,
        );
        const tickMaterial = new THREE.MeshBasicMaterial({ color: color });
        const tick = new THREE.Mesh(tickGeometry, tickMaterial);
        tick.position.copy(tickPos);
        tick.quaternion.copy(perpRots[pIdx]);
        axesGroup.add(tick);
      });
    }

    // Axis label (using sprite for simplicity)
    const labelPos = origin
      .clone()
      .add(dir.clone().multiplyScalar(axisLength + 0.08));
    const label = createTextSprite(axisConfig.name, color);
    label.position.copy(labelPos);
    label.scale.set(0.1, 0.05, 1);
    axesGroup.add(label);
  });

  scene.add(axesGroup);
  return axesGroup;
}

/**
 * Creates a text sprite for axis labels.
 */
function createTextSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `#${color.getHexString()}`;
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 16);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
  });
  return new THREE.Sprite(material);
}

/**
 * Updates axes when color space changes.
 */
function updateAxes(scene, colorSpaceKey) {
  // Remove old axes
  const oldAxes = scene.getObjectByName("colorSpaceAxes");
  if (oldAxes) {
    scene.remove(oldAxes);
    oldAxes.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }
  // Create new axes
  return createAxes(scene, colorSpaceKey);
}

/**
 * Creates the lil-gui control panel.
 */
function createGUI(app) {
  const gui = new GUI({ title: "Point Cloud Controls" });

  // Settings object for lil-gui bindings
  const guiParams = {
    colorSpace: currentColorSpace,
    pointDensity: SUBSAMPLE_FACTOR,
    showShadows: SHADOW_ENABLED,
  };

  // Color Space dropdown
  gui
    .add(guiParams, "colorSpace", Object.keys(COLOR_SPACES))
    .name("Color Space")
    .onChange((value) => {
      currentColorSpace = value;
      saveSetting("colorspace", value);
      const config = COLOR_SPACES[value];

      // Update shader uniforms
      app.pointsUniforms.colorSpaceMode.value = config.shaderMode;
      if (app.shadowUniforms) {
        app.shadowUniforms.colorSpaceMode.value = config.shaderMode;
      }

      // Update axes
      updateAxes(app.scene, value);
    });

  // Point Density slider
  gui
    .add(guiParams, "pointDensity", 1, 8, 1)
    .name("Point Density (1/n²)")
    .onFinishChange((value) => {
      if (value !== SUBSAMPLE_FACTOR) {
        saveSetting("subsample", value);
        location.reload();
      }
    });

  // Shadow toggle
  gui
    .add(guiParams, "showShadows")
    .name("Show Shadows")
    .onChange((value) => {
      saveSetting("shadow", value);
      const shadowCloud = app.scene.getObjectByName("pointCloudShadow");
      if (shadowCloud) {
        shadowCloud.visible = value;
      }
    });

  return gui;
}

/**
 * Returns runtime objects needed by the animation loop.
 */
export async function initExercise1() {
  const container = document.getElementById("container");

  const scene = new THREE.Scene();

  const fov = 60;
  const aspect = window.innerWidth / window.innerHeight;
  const near = 0.1;
  const far = 200;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0, 1, 2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();

  const textureLoader = new THREE.TextureLoader();
  const textureForShader = await textureLoader.loadAsync(
    "./Assests/grenouille.jpg",
  );
  // Use NoColorSpace so WebGL does not apply its automatic sRGB→linear decode
  // when the shader samples this texture.  The JPEG is sRGB-encoded; with
  // NoColorSpace the shader receives the raw sRGB values (0‑1 floats) and can
  // output them directly to the sRGB framebuffer without any manual conversion.
  textureForShader.colorSpace = THREE.NoColorSpace;

  const texVertexShader =
    document.getElementById("texVertexShader").textContent;
  const texFragmentShader =
    document.getElementById("texFragmentShader").textContent;

  const pointsVertexShader =
    document.getElementById("pointsVertexShader").textContent;
  const pointsFragmentShader = document.getElementById(
    "pointsFragmentShader",
  ).textContent;

  const uniforms = {
    time: { value: 0.0 },
    tex: { value: textureForShader },
  };

  const texmaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: texVertexShader,
    fragmentShader: texFragmentShader,
    side: THREE.DoubleSide,
  });

  const geometry = new THREE.PlaneGeometry(1, 1, 100, 100);
  const mesh = new THREE.Mesh(geometry, texmaterial);
  mesh.rotation.x = Math.PI / 2.0;
  mesh.rotation.z = Math.PI;
  scene.add(mesh);

  // Create DataTexture from image for GPU-based point cloud
  const image = textureForShader.image;
  const width = image.width;
  const height = image.height;

  // Extract pixel data once for DataTexture
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixelData = context.getImageData(0, 0, width, height).data;

  // Float32 textures cannot use WebGL's hardware sRGB decode path, so no GPU
  // linearisation ever occurs regardless of the colorSpace tag.  We store the
  // raw sRGB values (0‑1) read from the JPEG and mark the texture as
  // SRGBColorSpace so readers know the data is sRGB-encoded.
  // The vertex/fragment shaders receive these sRGB values and output them
  // directly to the sRGB framebuffer, which is the correct display pipeline.
  const numTexels = width * height;
  const rgbData = new Float32Array(numTexels * 4);
  for (let i = 0; i < numTexels; i++) {
    const p = i * 4;
    rgbData[i * 4] = pixelData[p] / 255;
    rgbData[i * 4 + 1] = pixelData[p + 1] / 255;
    rgbData[i * 4 + 2] = pixelData[p + 2] / 255;
    rgbData[i * 4 + 3] = 1.0;
  }
  const pointsDataTexture = new THREE.DataTexture(
    rgbData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  pointsDataTexture.colorSpace = THREE.SRGBColorSpace;
  pointsDataTexture.needsUpdate = true;

  // Create SUBSAMPLED UV grid geometry - positions computed in shader
  const sampledWidth = Math.ceil(width / SUBSAMPLE_FACTOR);
  const sampledHeight = Math.ceil(height / SUBSAMPLE_FACTOR);
  const numPoints = sampledWidth * sampledHeight;

  console.log(
    `Point cloud: ${width}×${height} → ${sampledWidth}×${sampledHeight} (${numPoints.toLocaleString()} points, ${SUBSAMPLE_FACTOR}× subsampling)`,
  );

  const pointCloudGeometry = new THREE.BufferGeometry();
  const gridUVs = new Float32Array(numPoints * 2);
  let idx = 0;
  for (let y = 0; y < height; y += SUBSAMPLE_FACTOR) {
    for (let x = 0; x < width; x += SUBSAMPLE_FACTOR) {
      gridUVs[idx * 2] = (x + 0.5) / width;
      gridUVs[idx * 2 + 1] = (y + 0.5) / height;
      idx++;
    }
  }
  pointCloudGeometry.setAttribute(
    "gridUV",
    new THREE.Float32BufferAttribute(gridUVs, 2),
  );
  // Dummy position attribute required by Three.js
  pointCloudGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(numPoints * 3), 3),
  );

  const pointsUniforms = {
    pointsTex: { value: pointsDataTexture },
    texSize: { value: new THREE.Vector2(width, height) },
    colorSpaceMode: { value: COLOR_SPACES[currentColorSpace].shaderMode },
  };

  const pointsMaterial = new THREE.ShaderMaterial({
    uniforms: pointsUniforms,
    vertexShader: pointsVertexShader,
    fragmentShader: pointsFragmentShader,
    // Opaque + depth writes: points properly occlude each other and are always
    // fully visible. The circular discard in the fragment shader does not require
    // transparency mode.
    transparent: false,
    depthWrite: true,
  });

  const pointCloud = new THREE.Points(pointCloudGeometry, pointsMaterial);
  pointCloud.name = "pointCloud";
  // Positions are computed in the vertex shader from the DataTexture, so
  // Three.js sees only the dummy all-zero position attribute and computes a
  // zero-radius bounding sphere at the origin.  This causes the entire cloud
  // to be frustum-culled away the moment the origin leaves the view frustum.
  pointCloud.frustumCulled = false;
  scene.add(pointCloud);

  // Create shadow point cloud with even more subsampling
  let shadowCloud = null;
  let shadowUniforms = null;

  // Always create shadow geometry (for UI toggle), but set visibility based on setting
  const shadowVertexShader =
    document.getElementById("shadowVertexShader").textContent;
  const shadowFragmentShader = document.getElementById(
    "shadowFragmentShader",
  ).textContent;

  // Shadow uses fewer points for performance
  const shadowSubsample = SUBSAMPLE_FACTOR * SHADOW_SUBSAMPLE_MULTIPLIER;
  const shadowWidth = Math.ceil(width / shadowSubsample);
  const shadowHeight = Math.ceil(height / shadowSubsample);
  const numShadowPoints = shadowWidth * shadowHeight;

  const shadowGeometry = new THREE.BufferGeometry();
  const shadowUVs = new Float32Array(numShadowPoints * 2);
  let sIdx = 0;
  for (let y = 0; y < height; y += shadowSubsample) {
    for (let x = 0; x < width; x += shadowSubsample) {
      shadowUVs[sIdx * 2] = (x + 0.5) / width;
      shadowUVs[sIdx * 2 + 1] = (y + 0.5) / height;
      sIdx++;
    }
  }
  shadowGeometry.setAttribute(
    "gridUV",
    new THREE.Float32BufferAttribute(shadowUVs, 2),
  );
  shadowGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(numShadowPoints * 3), 3),
  );

  shadowUniforms = {
    pointsTex: { value: pointsDataTexture },
    colorSpaceMode: { value: COLOR_SPACES[currentColorSpace].shaderMode },
    shadowY: { value: 0.251 },
  };

  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: shadowUniforms,
    vertexShader: shadowVertexShader,
    fragmentShader: shadowFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
  });

  shadowCloud = new THREE.Points(shadowGeometry, shadowMaterial);
  shadowCloud.name = "pointCloudShadow";
  shadowCloud.frustumCulled = false; // same reason as pointCloud above
  shadowCloud.renderOrder = -1;
  shadowCloud.visible = SHADOW_ENABLED; // Apply saved setting
  scene.add(shadowCloud);

  console.log(
    `Shadow cloud: ${shadowWidth}×${shadowHeight} (${numShadowPoints.toLocaleString()} points, visible: ${SHADOW_ENABLED})`,
  );

  // Create bounding cube and axes
  createBoundingCube(scene);
  createAxes(scene, currentColorSpace);

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
    uniforms,
    pointsUniforms,
    shadowUniforms,
    startTime: Date.now(),
  };

  // Create lil-gui control panel
  createGUI(app);

  return app;
}

export function animateExercise1(app) {
  function animate() {
    requestAnimationFrame(animate);

    const elapsedMilliseconds = Date.now() - app.startTime;
    const elapsedSeconds = elapsedMilliseconds / 1000;
    app.uniforms.time.value = elapsedSeconds;

    app.controls.update();
    app.renderer.render(app.scene, app.camera);
  }

  animate();
}
