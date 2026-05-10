import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { createXRCompatibleRenderer, setupXRExperience } from "../xr_support.js";

const IMAGE_PATH = "../assets/grenouille.jpg";
const VIDEO_PATH = "../assets/video-lowQ.mp4";
const SCALE = 0.75;
const DISCRET = 2;
const PLANE_W = 4.0;

const SPACES = {
  sRGB:   { mode: 0, ch: ["R", "G", "B"] },
  HSV:    { mode: 1, ch: ["H", "S", "V"] },
  CIEXYZ: { mode: 2, ch: ["X", "Y", "Z"] },
  CIExyY: { mode: 3, ch: ["x", "y", "Y"] },
  CIELAB: { mode: 4, ch: ["L*", "a*", "b*"] },
  CIELCH: { mode: 5, ch: ["L*", "C*", "H"] },
};

async function loadGlsl(path) {
  const url = new URL(path, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${path}`);
  return res.text();
}

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
  await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
  const t = new THREE.VideoTexture(v);
  t.colorSpace = THREE.NoColorSpace;
  await v.play();
  return { tex: t, w: v.videoWidth, h: v.videoHeight, el: v };
}

export async function initExercise3() {
  const [CONV, elevVert, elevFrag, TEX_VERT, TEX_FRAG] = await Promise.all([
    loadGlsl('../shared/colorConversions.glsl'),
    loadGlsl('./shaders/elevation.vert.glsl'),
    loadGlsl('./shaders/elevation.frag.glsl'),
    loadGlsl('./shaders/tex.vert.glsl'),
    loadGlsl('./shaders/tex.frag.glsl'),
  ]);
  const VERT = CONV + '\n' + elevVert;
  const FRAG = elevFrag;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 50);
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

  let { tex, w, h } = await loadImage(IMAGE_PATH);

  const uniforms = {
    tex:            { value: tex },
    scaleElevation: { value: SCALE },
    colorSpaceMode: { value: 0 },
    channelIndex:   { value: 0 },
    texelSize:      { value: new THREE.Vector2(1.0 / w, 1.0 / h) },
    // I = Ia*ka + Id*kd*max(0,dot(N,L)) — ambient floor at 0.3 prevents fully dark areas
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
    return new THREE.PlaneGeometry(PLANE_W, PLANE_W * f, Math.floor(w / DISCRET), Math.floor(h / DISCRET));
  }

  const mesh = new THREE.Mesh(makeGeo(w, h), mat);
  mesh.name = "elev";
  mesh.rotation.z = Math.PI;
  scene.add(mesh);

  // flat reference image sits below the elevation surface
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

  const app = { scene, camera, renderer, controls, uniforms, mesh, refMesh, refMat, makeGeo, w, h, videoEl: null };

  Object.assign(
    app,
    setupXRExperience({
      scene, camera, renderer, controls,
      title: "Exercise 3",
      description: "Inspect Lambert-lit elevation maps in VR and AR.",
      arWorldYOffset: -1.1,
      xrWorldZOffset: -3.5,
      // tilt ~63° so both the flat image and the surface are visible diagonally
      xrRotationX: -Math.PI * 0.35,
      xrRotationZ: Math.PI,
      xrScale: 0.35,
    }),
  );

  buildGUI(app);

  // panel lives in scene (not worldRoot) so rotation/scale don't affect its position
  const xrPanel = createXRControlPanel(app);
  scene.add(xrPanel);
  renderer.xr.addEventListener("sessionstart", () => { xrPanel.visible = true; });
  renderer.xr.addEventListener("sessionend",   () => { xrPanel.visible = false; });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return app;
}

function createXRControlPanel(app) {
  const group = new THREE.Group();
  group.name = "xrControlPanel";
  group.visible = false;
  group.position.set(0, 0.2, -1.0);

  const colorSpaceKeys = Object.keys(SPACES);
  const ps = { csIdx: 0, chIdx: 0 };

  function makeBtn(label, getVal, onPress) {
    const CW = 512, CH = 148;
    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), mat);
    let hov = false;

    function draw() {
      ctx.clearRect(0, 0, CW, CH);
      const r = 24;
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(CW - r, 0); ctx.quadraticCurveTo(CW, 0, CW, r);
      ctx.lineTo(CW, CH - r); ctx.quadraticCurveTo(CW, CH, CW - r, CH);
      ctx.lineTo(r, CH); ctx.quadraticCurveTo(0, CH, 0, CH - r);
      ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.fillStyle = hov ? "rgba(60,130,255,0.58)" : "rgba(8,10,22,0.82)";
      ctx.fill();
      ctx.strokeStyle = hov ? "rgba(140,200,255,1.0)" : "rgba(70,110,200,0.42)";
      ctx.lineWidth = hov ? 5 : 3;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(150,190,255,0.62)";
      ctx.font = "bold 22px Arial";
      ctx.fillText(label, CW / 2, CH * 0.27);
      ctx.fillStyle = hov ? "#ffffff" : "#b0d4ff";
      ctx.font = "bold 38px Arial";
      ctx.fillText(getVal(), CW / 2, CH * 0.68);
      texture.needsUpdate = true;
    }
    draw();

    return {
      mesh,
      setHovered(v) { hov = v; draw(); },
      press()       { onPress(); draw(); },
      redraw()      { draw(); },
    };
  }

  const SPACING = 0.32;

  const ps2 = { source: "image" };

  // chBtn forward-declared so csBtn's handler can redraw it after a space change
  let chBtn;
  const csBtn = makeBtn(
    "COLOR SPACE",
    () => colorSpaceKeys[ps.csIdx],
    () => {
      ps.csIdx = (ps.csIdx + 1) % colorSpaceKeys.length;
      ps.chIdx = 0;
      app.uniforms.colorSpaceMode.value = SPACES[colorSpaceKeys[ps.csIdx]].mode;
      app.uniforms.channelIndex.value = 0;
      if (chBtn) chBtn.redraw();
    },
  );
  csBtn.mesh.position.set(-SPACING, 0, 0);

  chBtn = makeBtn(
    "CHANNEL",
    () => SPACES[colorSpaceKeys[ps.csIdx]].ch[ps.chIdx],
    () => {
      const ch = SPACES[colorSpaceKeys[ps.csIdx]].ch;
      ps.chIdx = (ps.chIdx + 1) % ch.length;
      app.uniforms.channelIndex.value = ps.chIdx;
    },
  );
  chBtn.mesh.position.set(0, 0, 0);

  const srcBtn = makeBtn(
    "SOURCE",
    () => ps2.source.toUpperCase(),
    async () => {
      ps2.source = ps2.source === "image" ? "video" : "image";
      await switchSource(app, ps2.source === "video");
    },
  );
  srcBtn.mesh.position.set(SPACING, 0, 0);

  group.add(csBtn.mesh, chBtn.mesh, srcBtn.mesh);

  const btnList  = [csBtn, chBtn, srcBtn];
  const meshList = btnList.map((b) => b.mesh);
  const hovered  = new Map(btnList.map((b) => [b, false]));

  const raycaster = new THREE.Raycaster();
  const tempMtx   = new THREE.Matrix4();
  const tipPos    = new THREE.Vector3();
  const btnPos    = new THREE.Vector3();
  const HAND_HOVER_RADIUS = 0.06;

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

  const rayGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -3),
  ]);
  const rayMat = new THREE.LineBasicMaterial({ color: 0xff2222 });

  const controllers = [0, 1].map((i) => {
    const ctrl = app.renderer.xr.getController(i);
    app.scene.add(ctrl);
    ctrl.add(new THREE.Line(rayGeom, rayMat));
    ctrl.addEventListener("selectstart", () => pressRay(ctrl));
    return ctrl;
  });

  const hands = [0, 1].map((i) => {
    const hand = app.renderer.xr.getHand(i);
    app.scene.add(hand);
    return hand;
  });

  app._xrUpdatePanel = function () {
    if (!group.visible) return;
    const next = new Map(btnList.map((b) => [b, false]));

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

async function switchSource(app, toVideo) {
  if (toVideo) {
    const res = await loadVideo(VIDEO_PATH);
    app.videoEl = res.el;
    app.uniforms.tex.value = res.tex;
    app.refMat.uniforms.tex.value = res.tex;
    if (res.w !== app.w || res.h !== app.h) {
      app.w = res.w; app.h = res.h;
      app.uniforms.texelSize.value.set(1.0 / res.w, 1.0 / res.h);
      rebuildGeo(app);
    }
  } else {
    if (app.videoEl) { app.videoEl.pause(); app.videoEl = null; }
    const res = await loadImage(IMAGE_PATH);
    app.uniforms.tex.value = res.tex;
    app.refMat.uniforms.tex.value = res.tex;
    if (res.w !== app.w || res.h !== app.h) {
      app.w = res.w; app.h = res.h;
      app.uniforms.texelSize.value.set(1.0 / res.w, 1.0 / res.h);
      rebuildGeo(app);
    }
  }
}

function buildGUI(app) {
  const gui = new GUI({ title: "Lambert Lighting Controls" });
  const p = { colorSpace: "sRGB", channel: "R", source: "image" };
  let chCtrl = null;

  function rebuildChannelCtrl() {
    if (chCtrl) chCtrl.destroy();
    const ch = SPACES[p.colorSpace].ch;
    chCtrl = gui.add(p, "channel", ch).name("Channel → Height").onChange((v) => {
      app.uniforms.channelIndex.value = ch.indexOf(v);
    });
  }

  gui.add(p, "colorSpace", Object.keys(SPACES)).name("Color Space").onChange((v) => {
    app.uniforms.colorSpaceMode.value = SPACES[v].mode;
    p.channel = SPACES[v].ch[0];
    app.uniforms.channelIndex.value = 0;
    rebuildChannelCtrl();
  });
  rebuildChannelCtrl();

  gui.add(p, "source", ["image", "video"]).name("Source").onChange(async (v) => {
    await switchSource(app, v === "video");
  });

  const vc = {
    playPause()   { if (app.videoEl) app.videoEl.paused ? app.videoEl.play() : app.videoEl.pause(); },
    seekBack()    { if (app.videoEl) app.videoEl.currentTime = Math.max(0, app.videoEl.currentTime - 10); },
    seekForward() { if (app.videoEl) app.videoEl.currentTime = Math.min(app.videoEl.duration, app.videoEl.currentTime + 10); },
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

export function animateExercise3(app) {
  app.renderer.setAnimationLoop(() => {
    if (!app.renderer.xr.isPresenting) app.controls.update();
    if (app._xrUpdatePanel) app._xrUpdatePanel();
    app.renderer.render(app.scene, app.camera);
  });
}
