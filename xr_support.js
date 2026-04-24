import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { ARButton } from "three/addons/webxr/ARButton.js";

function createOverlay(title, description) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.top = "16px";
  overlay.style.left = "16px";
  overlay.style.padding = "10px 14px";
  overlay.style.borderRadius = "8px";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.color = "#ffffff";
  overlay.style.fontFamily = "sans-serif";
  overlay.style.fontSize = "13px";
  overlay.style.lineHeight = "1.5";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "50";
  overlay.innerHTML = `
    <strong>${title}</strong><br />
    ${description}<br />
    Session: <span data-session-mode>Desktop</span>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function createWorldRoot(scene) {
  const worldRoot = new THREE.Group();
  worldRoot.name = "xrWorldRoot";

  [...scene.children].forEach((child) => {
    worldRoot.add(child);
  });

  scene.add(worldRoot);
  return worldRoot;
}

function snapshotCameraPose(camera, controls) {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: controls.target.clone(),
  };
}

function applyDesktopCameraPose(camera, controls, pose) {
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  controls.target.copy(pose.target);
  controls.update();
}

function applyXRBaseCameraPose(camera, controls) {
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  controls.target.set(0, 0, -1);
  controls.update();
}

function forceXRWebGLLayerFallback() {
  const originalXRWebGLBinding = globalThis.XRWebGLBinding;

  if (typeof originalXRWebGLBinding === "undefined") {
    return () => {};
  }

  try {
    globalThis.XRWebGLBinding = undefined;
  } catch {
    return () => {};
  }

  return () => {
    globalThis.XRWebGLBinding = originalXRWebGLBinding;
  };
}

function applyWorldPlacement(worldRoot, config, session) {
  const isPassthrough = Boolean(
    session &&
    ["alpha-blend", "additive"].includes(session.environmentBlendMode),
  );

  worldRoot.position.set(
    session ? config.xrWorldXOffset : 0,
    session ? (isPassthrough ? config.arWorldYOffset : -0.75) : 0,
    session ? (isPassthrough ? config.xrWorldZOffset : -1.75) : 0,
  );

  worldRoot.rotation.set(
    session ? config.xrRotationX : 0,
    session ? config.xrRotationY : 0,
    session ? config.xrRotationZ : 0,
  );

  worldRoot.scale.setScalar(session ? config.xrScale : 1);

  return isPassthrough;
}

export function createXRCompatibleRenderer(options = {}) {
  const restoreXRWebGLBinding = forceXRWebGLLayerFallback();

  try {
    return new THREE.WebGLRenderer(options);
  } finally {
    restoreXRWebGLBinding();
  }
}

export function setupXRExperience({
  scene,
  camera,
  renderer,
  controls,
  title,
  description,
  xrWorldXOffset = 0,
  arWorldYOffset = -0.5,
  xrWorldZOffset = 2.25,
  xrRotationX = 0,
  xrRotationY = 0,
  xrRotationZ = 0,
  xrScale = 1,
}) {
  const overlay = createOverlay(title, description);
  const sessionLabel = overlay.querySelector("[data-session-mode]");
  const worldRoot = createWorldRoot(scene);
  const desktopCameraPose = snapshotCameraPose(camera, controls);
  const desktopBackground = scene.background;
  const worldConfig = {
    xrWorldXOffset,
    arWorldYOffset,
    xrWorldZOffset,
    xrRotationX,
    xrRotationY,
    xrRotationZ,
    xrScale,
  };

  renderer.xr.enabled = true;
  document.body.appendChild(VRButton.createButton(renderer));
  document.body.appendChild(
    ARButton.createButton(renderer, {
      optionalFeatures: ["dom-overlay", "local-floor"],
      domOverlay: { root: overlay },
    }),
  );

  function updateXRSessionState() {
    const session = renderer.xr.getSession();
    const isPassthrough = applyWorldPlacement(worldRoot, worldConfig, session);

    scene.background = isPassthrough ? null : desktopBackground;

    if (session) {
      controls.enabled = false;
      applyXRBaseCameraPose(camera, controls);
    } else {
      controls.enabled = true;
      applyDesktopCameraPose(camera, controls, desktopCameraPose);
    }

    if (sessionLabel) {
      sessionLabel.textContent = isPassthrough
        ? "AR/MR"
        : session
          ? "VR"
          : "Desktop";
    }
  }

  renderer.xr.addEventListener("sessionstart", updateXRSessionState);
  renderer.xr.addEventListener("sessionend", updateXRSessionState);
  updateXRSessionState();

  return {
    overlay,
    worldRoot,
    updateXRSessionState,
  };
}
