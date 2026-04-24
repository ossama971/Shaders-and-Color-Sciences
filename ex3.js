/**
 * ex3.js — Exercise 3: Lambertian Lighting on Elevation Maps
 *
 * Builds on Exercise 2 by adding directional diffuse lighting.
 * Surface normals are derived from heightfield finite differences in the
 * vertex shader. The fragment shader applies:
 *   I = Ia * ka  +  Id * kd * max(0, dot(N, L))
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { createXRCompatibleRenderer, setupXRExperience } from "./xr_support.js";

// ============================================================================
// PATHS & DEFAULTS
// ============================================================================

const IMAGE_PATH = "./Assests/grenouille.jpg";
const VIDEO_PATH = "./Assests/video.mp4";
const SCALE = 0.75;
const DISCRET = 2;
const PLANE_W = 4.0;

// ============================================================================
// COLOUR SPACES
// ============================================================================

const SPACES = {
  sRGB: { mode: 0, ch: ["R", "G", "B"] },
  HSV: { mode: 1, ch: ["H", "S", "V"] },
  CIEXYZ: { mode: 2, ch: ["X", "Y", "Z"] },
  CIExyY: { mode: 3, ch: ["x", "y", "Y"] },
  CIELAB: { mode: 4, ch: ["L*", "a*", "b*"] },
  CIELCH: { mode: 5, ch: ["L*", "C*", "H"] },
};

// ============================================================================
// SHADER HELPERS
// ============================================================================

function src(id) {
  return document.getElementById(id).textContent.trim();
}

const CONV = src("shaderConversions");
const VERT = CONV + "\n" + src("elevationVertexShader");
const FRAG = src("elevationFragmentShader");
const TEX_VERT = src("texVertexShader");
const TEX_FRAG = src("texFragmentShader");

// ============================================================================
// MEDIA LOADERS
// ============================================================================

async function loadImage(path) {
  const t = await new THREE.TextureLoader().loadAsync(path);
  t.colorSpace = THREE.NoColorSpace;
  return {
    tex: t,
    w: t.image.naturalWidth || t.image.width,
    h: t.image.naturalHeight || t.image.height,
  };
}

async function loadVideo(path) {
  const v = document.createElement("video");
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.crossOrigin = "anonymous";
  v.src = path;
  await new Promise((r) =>
    v.addEventListener("loadedmetadata", r, { once: true }),
  );
  const t = new THREE.VideoTexture(v);
  t.colorSpace = THREE.NoColorSpace;
  await v.play();
  return { tex: t, w: v.videoWidth, h: v.videoHeight, el: v };
}

// ============================================================================
// INIT
// ============================================================================

export async function initExercise3() {
  // ---- Scene, camera, renderer ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(
    60,
    innerWidth / innerHeight,
    0.1,
    50,
  );
  camera.position.set(2, 8, 2);
  camera.up.set(0, 0, 1);

  const renderer = createXRCompatibleRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // ---- Load image ----
  let { tex, w, h } = await loadImage(IMAGE_PATH);

  // ---- Elevation + lighting uniforms ----
  const uniforms = {
    tex: { value: tex },
    scaleElevation: { value: SCALE },
    colorSpaceMode: { value: 0 },
    channelIndex: { value: 0 },
    texelSize: { value: new THREE.Vector2(1.0 / w, 1.0 / h) },
    // Lighting constants (PDF §6.1 + §6.3)
    // I = Ia*ka + Id*kd*max(0, dot(N,L))
    // Ambient floor Ia*ka = 0.3 prevents completely dark areas
    lightDir: { value: new THREE.Vector3(1.0, 1.0, 1.0).normalize() },
    Id: { value: 1.0 },
    kd: { value: 0.7 },
    Ia: { value: 0.3 },
    ka: { value: 1.0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });

  function makeGeo(w, h) {
    const f = h / w;
    return new THREE.PlaneGeometry(
      PLANE_W,
      PLANE_W * f,
      Math.floor(w / DISCRET),
      Math.floor(h / DISCRET),
    );
  }

  const mesh = new THREE.Mesh(makeGeo(w, h), mat);
  mesh.name = "elev";
  mesh.rotation.z = Math.PI;
  scene.add(mesh);

  // ---- Flat reference (original texture below) ----
  const refMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: tex } },
    vertexShader: TEX_VERT,
    fragmentShader: TEX_FRAG,
    side: THREE.DoubleSide,
  });
  const refMesh = new THREE.Mesh(makeGeo(w, h), refMat);
  refMesh.name = "ref";
  refMesh.position.z = -1.5;
  refMesh.rotation.z = Math.PI;
  scene.add(refMesh);

  // ---- State ----
  const app = {
    scene,
    camera,
    renderer,
    controls,
    uniforms,
    mesh,
    refMesh,
    refMat,
    makeGeo,
    w,
    h,
    videoEl: null,
  };

  Object.assign(
    app,
    setupXRExperience({
      scene,
      camera,
      renderer,
      controls,
      title: "Exercise 3",
      description: "Inspect Lambert-lit elevation maps in VR and AR.",
      arWorldYOffset: -0.35,
      xrWorldZOffset: -3.25,
    }),
  );

  // ---- GUI ----
  buildGUI(app);

  // ---- Resize ----
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return app;
}

// ============================================================================
// GUI
// ============================================================================

function buildGUI(app) {
  const gui = new GUI({ title: "Lambert Lighting Controls" });

  const p = { colorSpace: "sRGB", channel: "R", source: "image" };
  let chCtrl = null;

  // ---- Color space ----
  function rebuildChannelCtrl() {
    if (chCtrl) chCtrl.destroy();
    const ch = SPACES[p.colorSpace].ch;
    chCtrl = gui
      .add(p, "channel", ch)
      .name("Channel → Height")
      .onChange((v) => {
        app.uniforms.channelIndex.value = ch.indexOf(v);
      });
  }

  gui
    .add(p, "colorSpace", Object.keys(SPACES))
    .name("Color Space")
    .onChange((v) => {
      app.uniforms.colorSpaceMode.value = SPACES[v].mode;
      p.channel = SPACES[v].ch[0];
      app.uniforms.channelIndex.value = 0;
      rebuildChannelCtrl();
    });
  rebuildChannelCtrl();

  // ---- Source ----
  gui
    .add(p, "source", ["image", "video"])
    .name("Source")
    .onChange(async (v) => {
      if (v === "video") {
        const res = await loadVideo(VIDEO_PATH);
        app.videoEl = res.el;
        app.uniforms.tex.value = res.tex;
        app.refMat.uniforms.tex.value = res.tex;
        if (res.w !== app.w || res.h !== app.h) {
          app.w = res.w;
          app.h = res.h;
          app.uniforms.texelSize.value.set(1.0 / res.w, 1.0 / res.h);
          rebuildGeo(app);
        }
      } else {
        if (app.videoEl) {
          app.videoEl.pause();
          app.videoEl = null;
        }
        const res = await loadImage(IMAGE_PATH);
        app.uniforms.tex.value = res.tex;
        app.refMat.uniforms.tex.value = res.tex;
        if (res.w !== app.w || res.h !== app.h) {
          app.w = res.w;
          app.h = res.h;
          app.uniforms.texelSize.value.set(1.0 / res.w, 1.0 / res.h);
          rebuildGeo(app);
        }
      }
    });

  // Video transport
  const vc = {
    playPause() {
      if (app.videoEl)
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
  gui.add(vc, "seekBack").name("◀◀ -10s");
  gui.add(vc, "playPause").name("⏯ Play / Pause");
  gui.add(vc, "seekForward").name("▶▶ +10s");
}

function rebuildGeo(app) {
  const g = app.makeGeo(app.w, app.h);
  app.mesh.geometry.dispose();
  app.mesh.geometry = g;
  app.refMesh.geometry.dispose();
  app.refMesh.geometry = g.clone();
}

// ============================================================================
// LOOP
// ============================================================================

export function animateExercise3(app) {
  app.renderer.setAnimationLoop(() => {
    if (!app.renderer.xr.isPresenting) {
      app.controls.update();
    }
    app.renderer.render(app.scene, app.camera);
  });
}
