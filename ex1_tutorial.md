# Exercise 1 Tutorial: Color-Space Point-Cloud Visualization

---

## Learning Objectives

By the end of this exercise you will be able to:

1. Implement the full sRGB to linear to CIEXYZ to CIExyY / CIELAB / CIELCH
   conversion chain as a set of composable GLSL functions.
2. Design deliberate 3D position mappings for six different color spaces that
   reveal each space's underlying geometric structure.
3. Build a Gaussian additive density visualization using Three.js blending modes
   and understand why each material flag is required.
4. Explain the color management pipeline: why sRGB values must be linearised
   before any colorimetric computation and what goes wrong if they are not.
5. Load video as a continuously-updating GPU texture using `THREE.VideoTexture`
   and hot-swap image/video sources at runtime without touching any GLSL.

---

## Prerequisites

- Basic Three.js: scenes, cameras, renderers, ShaderMaterial, Points geometry.
- GLSL: uniforms, varyings, texture2D sampling, vec3/mat3 arithmetic.
- No prior exposure to color science is required — this exercise is self-contained.

---

## Architecture Overview

```
Scene
 ├── Plane (PlaneGeometry, DoubleSide)   @ world x = -0.75   <- texture display
 └── colorSpaceGroup (THREE.Group)       @ world x = +0.75   <- all cloud objects
       ├── BoundingCube (1x1x1, local origin at (-0.5, 0.25, -0.5))
       ├── Axes (one cylinder + label sprite per axis)
       ├── Points "pointCloud"          (direct — opaque, depthWrite:true)
       ├── Points "pointCloudDensity"   (additive Gaussian, depthWrite:false)
       └── Points "pointCloudShadow"    (projected floor shadow, MultiplyBlending)
```

The texture plane and the color-space cube are placed side by side at the same
world height (y = 0.75) so they are both visible in the default camera view.
Camera sits at (0, 0.75, 3) looking at (0, 0.75, 0).

The `colorSpaceMode` integer uniform is the bridge between JavaScript and GLSL.
Whenever the user picks a color space from the GUI, a new integer is pushed to
the shader which branches to the matching conversion chain and position formula.

---

## Step 1 — Scene Architecture (Conceptual)

Before writing any shader code it is worth understanding why the scene is
structured the way it is. These decisions will guide every later TODO.

### Why the side-by-side layout?

The texture plane on the left gives you an immediate reference for which
colours are in the image. The 3D cube on the right shows where those same
colours land in each color space. When you switch color spaces you can glance
left to recall an area of the frog (orange skin, green back, dark shadow) and
immediately find the corresponding cluster in the cube on the right.

The plane is vertical (no rotation.x) and uses DoubleSide so it stays visible
when you orbit the camera behind it. PlaneGeometry(1, 1) centred at x=-0.75,
y=0.75 spans world x in [-1.25, -0.25] and y in [0.25, 1.25].

### Why colorSpaceGroup?

All cloud-related objects (bounding cube, axes, three Points objects) are added
to a single THREE.Group placed at x=+0.75. This means:

- All point positions are expressed in group-local space. The GLSL never
  adds +0.75 — the group transform handles it.
- Switching color spaces only needs to rebuild the point cloud geometry
  conceptually; the group stays in place.
- updateAxes() only needs to traverse the group, not the whole scene.

### Why frustumCulled = false?

Three.js computes a bounding sphere for each Points object at creation time
using the dummy position attribute (all zeros). When the camera moves, the
engine checks whether that sphere intersects the view frustum. Because the
dummy sphere is centred at the group origin, it fails the culling test the
moment the camera angle changes — and the entire cloud vanishes. Disabling
frustum culling prevents this. The vertex shader computes real positions, so
Three.js's bounding data is meaningless anyway.

### The perspective-correct point size formula

```glsl
gl_PointSize = max(K / -mvPos.z, minSize);
```

`-mvPos.z` is the positive depth of the vertex in camera space. As the camera
zooms in, depth decreases and point size grows proportionally — points stay the
same screen-space fraction of the scene regardless of zoom level. The `max`
clamp prevents points from collapsing to sub-pixel size when the camera is far
away. The direct cloud uses K=6 (small, crisp), the density cloud uses K=14
(large sprites that overlap and accumulate).

---

## Step 2 — The Color Pipeline: Why Order Matters

### sRGB is not linear light

JPEG and PNG images store sRGB values: a non-linear, gamma-compressed encoding
designed so that the human eye perceives smooth gradients on typical monitors.
Specifically, a pixel value of 0.5 in sRGB does **not** correspond to 50%
physical light intensity — it corresponds to roughly 21% (because 0.5^2.2 ≈ 0.218).

The D65 matrix in rgb2xyz and every subsequent CIE formula was derived by
researchers measuring *physical light*. If you feed sRGB values directly into
the matrix you are applying colour science to display encoding rather than
to real-world light. The resulting XYZ values are wrong: white maps to
roughly (0.45, 0.21, 0.07) instead of the correct (0.95, 1.00, 1.09).

### Why srgbToLinear must be called first

TODO 4 (srgbToLinear) is the gateway through which all subsequent conversions
must pass. The correct call chain is:

```
sRGB (0–1, gamma-compressed)
  -> srgbToLinear           <- TODO 4
  -> linear RGB (0–1, physical light)
  -> rgb2xyz via D65 matrix <- TODO 5
  -> xyz2xyY / xyz2lab      <- TODOs 6, 7
  -> lab2lch                <- TODO 8
```

Forgetting to call srgbToLinear is the single most common mistake. The visual
symptom is that all CIE spaces look slightly wrong: hues are shifted, white
does not land at the expected position, and CIELAB L*=100 is unreachable.

### Why mix() and step() instead of if/else?

GPU fragment shaders execute in lock-step across groups of threads (warps or
subgroups). When some threads take the `if` branch and others take the `else`
branch, the GPU must execute *both* branches for the entire group and mask out
the unwanted results. This is called branch divergence. For per-component
operations like the sRGB transfer function, `mix(low, high, step(threshold, c))`
computes both branches unconditionally for all three channels simultaneously —
no divergence, better throughput.

The formula for a single channel:

```
step(0.04045, c)  →  0.0 when c < 0.04045,  1.0 when c >= 0.04045
mix(c/12.92, pow((c+0.055)/1.055, 2.4), s)
  →  c/12.92            when s = 0  (low end)
  →  pow(...)           when s = 1  (high end)
```

---

## Step 3 — CIEXYZ: The Root Conversion (TODO 5)

### The D65 illuminant

CIEXYZ is a linear transform from physical linear-light RGB. The "D65"
suffix refers to the reference illuminant: a daylight spectrum with a
correlated colour temperature of approximately 6500 K. D65 is the standard
white point for sRGB displays, which is why we use the D65 version of the
matrix. Using a different white point (D50, C, E) would shift where pure white
lands in XYZ space.

### The matrix in math vs GLSL notation

In row-vector math notation the transform is written as:

```
[X]   [0.4124564  0.3575761  0.1804375] [R_lin]
[Y] = [0.2126729  0.7151522  0.0721750] [G_lin]
[Z]   [0.0193339  0.1191920  0.9503041] [B_lin]
```

In GLSL, `mat3(a, b, c)` stores the values column-first: `a` is column 0
(the first column), not row 0. Therefore:

```glsl
mat3 m = mat3(
  0.4124564, 0.2126729, 0.0193339,  // column 0: R's contribution to X, Y, Z
  0.3575761, 0.7151522, 0.1191920,  // column 1: G's contribution to X, Y, Z
  0.1804375, 0.0721750, 0.9503041   // column 2: B's contribution to X, Y, Z
);
return m * lin; // matrix * column-vector = correct result
```

If you write the nine numbers in row-major order (matching the math notation)
without transposing, GLSL will silently interpret them as column-major. The
result looks plausible — colours are still in roughly the right region — but
X and Z are swapped and the yellow-blue axis is tilted.

**Debug checkpoint**: rgb2xyz(vec3(1.0)) should return approximately
vec3(0.9505, 1.0000, 1.0890). If X ≈ 1.089 and Z ≈ 0.950, the matrix is
transposed. If all three values are below 0.5, srgbToLinear is not being called.

---

## Step 4 — CIExyY: Separating Chromaticity (TODO 3)

### What chromaticity means

CIExyY separates a colour into two parts:
- **x, y** — the *chromaticity*: which hue and saturation, independent of how
  bright the light source is. Two colours with the same x, y but different Y
  look like the same hue at different brightness levels.
- **Y** — the *luminance*: how bright, independent of hue.

This separation is achieved by dividing each XYZ component by their sum
(X + Y + Z), which normalises away the overall intensity. The resulting x, y
values for real-world colours cluster inside a horseshoe-shaped region called
the CIE gamut boundary. Most photographic colours fall within x ∈ [0.1, 0.7]
and y ∈ [0.1, 0.6], so no extra scaling is needed to fit the unit cube.

### Division-by-zero guard

Pure black has X = Y = Z = 0, so the sum is 0. Without a guard, the shader
would produce NaN/Inf, which typically renders as a bright artifact or causes
the entire draw call to fail on some drivers. The guard `if (sum < 1e-6)
return vec3(0.0)` places black at the world origin (inside the bounding cube)
rather than at an undefined location.

**Debug checkpoint**: D65 white (1,1,1) sRGB → xyz(0.95, 1.00, 1.09) →
xyY(0.3127, 0.3290, 1.0). The x and y values should be near 0.31–0.33.
If they are near 0.33–0.34 you might be dividing by just X+Z instead of X+Y+Z.

---

## Step 5 — CIELAB: Perceptual Uniformity (TODO 4)

### Why CIELAB exists

CIEXYZ is physically linear but *perceptually non-uniform*: a step of 0.01 in
Y near black is far more visible than the same step near white because human
vision is logarithmic in brightness. CIELAB applies a cube-root compression
to the normalised XYZ values so that equal numerical distances correspond to
roughly equal perceived colour differences. This makes CIELAB the standard
space for measuring colour difference (ΔE).

### The labF piecewise function

The cube-root is undefined at zero and has infinite slope there, which causes
numerical instability. The linearisation below the threshold
`t = (6/29)^3 ≈ 0.00886` replaces the cube-root with a tangent line that
is smooth (C1 continuous) at the transition point:

```
t > delta^3  → f(t) = t^(1/3)
t <= delta^3 → f(t) = t / (3 * delta^2) + 4/29
```

### GLSL ordering requirement

GLSL compiles each shader as a single translation unit and performs a
single-pass parse. A function must be declared *above* any function that calls
it — there are no forward declarations in the subset of GLSL used here.
Therefore `labF` must appear textually before `xyz2lab` in the
`shaderConversions` block. If you define `xyz2lab` first and then add `labF`
below it, the shader will fail to compile with an "undeclared identifier" error
that Three.js reports in the browser console.

**Debug checkpoints**:
- White sRGB (1,1,1)  → CIELAB (100, 0, 0)
- Black sRGB (0,0,0)  → CIELAB (0, 0, 0)
- Mid-grey (0.5,0.5,0.5) sRGB → L* ≈ 53, a* ≈ 0, b* ≈ 0
- Pure sRGB red (1,0,0)  → a* large positive (near +80)
- Pure sRGB blue (0,0,1) → b* large negative (near -110)

---

## Step 6 — CIELCH: Cylindrical Polar Form (TODO 5)

### Why convert from rectangular to polar?

CIELAB expresses hue as a combination of two signed axes (a*, b*). CIELCH
expresses the same hue as a single angle h and a non-negative radius C
(chroma). The cylindrical form makes it visually obvious that:

- Saturation is the distance from the central grey axis (C* = radius).
- Hue is the angle around that axis.
- Achromatic greys have C* ≈ 0 and cluster tightly on the vertical axis.

Orbiting the camera around the vertical axis in CIELCH mode reveals this
cylinder — something that is much harder to see in CIELAB's rectangular form.

### atan2 range and normalisation

`atan(b, a)` (GLSL uses two-argument form) returns an angle in [-π, π].
For position mapping we need a non-negative value in [0, 1]. The correction is:

```glsl
if (h < 0.0) h += 6.28318530;  // shift to [0, 2pi]
h_norm = h / 6.28318530;        // normalise to [0, 1]
```

Note that h_norm = 0 and h_norm = 1 represent the same hue angle (the
boundary between red and red again, going around the wheel). In the position
mapping, this corresponds to two sides of the same position in the cylinder.

**Debug checkpoint**: An achromatic grey → C* ≈ 0.0 → r ≈ 0.0 → pos.x ≈ 0,
pos.z ≈ 0. The radius formula `r = clamp(C*/200, 0, 0.5)` keeps the cylinder
inside the bounding cube (max radius = 0.5 matches the cube half-width).

---

## Step 7 — Position Mapping Design (TODOs 6–9)

### The bounding cube coordinate system

The bounding cube occupies group-local space:
- x ∈ [-0.5, +0.5]  (right–left)
- y ∈ [+0.25, +1.25] (bottom–top)
- z ∈ [-0.5, +0.5]  (front–back)

Every position mapping subtracts 0.5 from the horizontal axes and adds 0.25
to the vertical axis. The formula pattern is always:

```glsl
pos.x = normalized_component_A - 0.5;
pos.y = normalized_component_luminance + 0.25;
pos.z = normalized_component_B - 0.5;
```

The luminance/brightness component always goes on the vertical axis (y) because
this matches the human intuition that bright things are "up" and dark things are
"down". Placing it vertically also makes the density shadow (which projects onto
y = 0.251, just above the floor) a natural projection that encodes the same
floor-pattern as the hue distribution.

### CIEXYZ (TODO 6)

X, Y, Z range from 0 to their respective D65 white-point values
(Xn=0.95047, Yn=1.0, Zn=1.08883). Dividing by each white-point value maps
the sRGB-reachable volume into [0, 1]^3. Clamp before offsetting to handle
out-of-gamut values that a floating-point accumulation might push outside
the exact [0,1] range.

### CIExyY (TODO 7)

The x and y chromaticity values for photographic images naturally lie within
[0, ~0.8] so no additional scaling is needed. Y is already in [0, 1].
Be careful with the component indices: our xyz2xyY returns vec3(x-chroma,
y-chroma, Y), so index 0 is x-chroma, index 1 is y-chroma, index 2 is Y-luma.
Luminance Y goes on the vertical axis.

### CIELAB (TODO 11)

L* ∈ [0, 100] — maps to the vertical axis with L*=50 at the cube's geometric
centre: `(L* - 50) / 100 + 0.75`. Black (L*=0) sits at the bottom, white (L*=100)
at the top, and medium grey exactly in the middle.

a* and b* ∈ roughly [−100, +100] → divide by 200 maps ±100 exactly to ±0.5,
filling the cube edge-to-edge symmetrically. The semantic centre of CIELAB —
neutral grey (a*=0, b*=0, L*=50) — lands at the exact geometric centre of the
bounding cube (0, 0.75, 0). Positive a* (red direction) extends to +x; negative
a* (green direction) to −x; positive b* (yellow) to +z; negative b* (blue) to −z.
Remember that L* is index 0 in the vec3 returned by xyz2lab (vec3(L*, a*, b*)),
so it is lab.x, a* is lab.y, and b* is lab.z.

### CIELCH (TODO 9)

The polar-to-Cartesian conversion turns angle h into (cos h, sin h) multiplied
by radius r. Clamp r to [0, 0.5] so the cylinder fits inside the cube. The
cylinder will be hollow at its centre (pure black, C*=0) and densest where the
most common hues in the image concentrate.

---

## Step 8 — Density Visualization (TODOs 10, 11, 12)

### Why the direct cloud fails to show density

In the direct cloud, each opaque point simply overwrites whatever was behind it.
A region of the cube where ten thousand image pixels share a similar colour looks
identical to a region where only ten pixels share that colour — in both cases
you see a single layer of opaque points. The structure and density of the colour
distribution is completely invisible.

### How additive blending reveals density

When `THREE.AdditiveBlending` is set and `depthWrite: false`, the GPU *adds*
each fragment's colour value to what is already in the framebuffer instead of
replacing it. A region where 1000 points overlap accumulates 1000 times the
per-point colour contribution: it glows brightly. A sparse region contributes
only a handful of points: it barely registers. The density of the point cloud
directly maps to the brightness of the rendered region.

`depthWrite: false` is mandatory. If depth writing is enabled, the first splat
that lands on a pixel wins the depth test and all subsequent splats behind it
are discarded — exactly defeating the purpose. With depth writing off, every
splat from every depth adds its contribution regardless of draw order.

### The Gaussian weight

```glsl
float weight = exp(-10.0 * dist * dist);
```

At the centre of the sprite (dist = 0), weight = 1.0. At the circle edge
(dist = 0.5), weight = exp(-2.5) ≈ 0.08. This smooth falloff avoids the harsh
edge that a flat circular disc would create and makes overlapping splats blend
together into a continuous glowing volume. Increasing k from 10 to 15 makes
each splat tighter and sharper; decreasing to 8 makes it softer and more spread.

### Material flags checklist

Every density ShaderMaterial MUST have:
```js
transparent:  true,          // tells Three.js to render in the transparent pass
depthWrite:   false,         // must be off for additive accumulation
blending:     THREE.AdditiveBlending,
```

Without `transparent: true`, Three.js renders the material in the opaque pass
where depth testing is stricter and alpha is ignored. Without `AdditiveBlending`,
fragments overwrite each other and the effect does not accumulate.

### The separate uniforms object

Both direct and density clouds share the same image texture and the same
colorSpaceMode, but they must have *separate* uniforms objects. Sharing one
object would mean that a color-space change can only update one reference — the
last `.value =` assignment would win and one cloud would show the wrong space.
Creating separate `pointsUniforms` and `densityUniforms` objects means the
colorSpace onChange handler can update both independently.

---

## TODO Walkthrough

| TODO | Location | Key step |
|------|----------|----------|
| 1 | ex1_hints.js | Implement `buildDataTexture`: canvas→getImageData→Float32Array→DataTexture |
| 2 | ex1_hints.js | Implement `buildPointGeometry`: UV grid Float32Array→gridUV BufferAttribute |
| 3 | ex1_hints.js | Create uniforms, ShaderMaterial, THREE.Points; set `frustumCulled = false` |
| 4 | shaderConversions | Replace `return c;` with `mix() + step()` formula |
| 5 | shaderConversions | Add mat3 D65 matrix; call srgbToLinear first |
| 6 | shaderConversions | Divide by X+Y+Z; guard against sum < 1e-6 |
| 7 | shaderConversions | Add labF ABOVE xyz2lab; use D65 white-point values |
| 8 | shaderConversions | length(lab.yz) for C*; atan + shift + normalise for h |
| 9 | pointsVertexShader | xyz = rgb2xyz; clamp/normalise; subtract 0.5 / add 0.25 |
| 10 | pointsVertexShader | xyY = xyz2xyY(rgb2xyz); watch component index ordering |
| 11 | pointsVertexShader | lab = xyz2lab(rgb2xyz); divide by 200 (a*/b*) and (L*-50)/100+0.75 (L*); lab.y is a* |
| 12 | pointsVertexShader | lch = lab2lch(xyz2lab(rgb2xyz)); polar-to-Cartesian |
| 13 | densityFragmentShader | Remove `discard;` stub; add Gaussian + low alpha |
| 14 | ex1_hints.js | Create densityGeo, densityUniforms, ShaderMaterial, Points |
| 15 | ex1_hints.js (createGUI) | Wire `visualMode` toggle; sync densityUniforms in colorSpace onChange |
| 16 | ex1_hints.js | Implement `loadVideoSource`: HTMLVideoElement → VideoTexture → `await play()` |
| 17 | ex1_hints.js (createGUI) | Add `'Source'` GUI control; swap all textures + rebuild geometry on change |

**Test order**: implement TODOs 1–3 in order — after TODO 3 the RGB point cloud appears
for the first time. Then implement TODO 4 (srgbToLinear) and check that colour distribution
shifts slightly. Implement TODO 5 (rgb2xyz) and switch to CIEXYZ — white should be at the
top-right-far corner. Continue through TODOs 6–8 switching to each CIE space to confirm
the expected geometry. Implement TODO 13 first (fragment) before TODO 14 (JS cloud), then
TODO 15 (GUI toggle). Implement TODO 16 (loadVideoSource) and test with the browser console
that the video element exists and plays; then implement TODO 17 (source selector) and confirm
the point cloud updates live when the video is playing.

---

## Common Pitfalls

1. **mat3 column-major trap** — Writing the D65 matrix in row-major order
   (matching the math notation) without transposing. Symptom: CIEXYZ mode has
   X and Z swapped; sRGB white maps to approximately (1.089, 1.000, 0.950)
   instead of (0.950, 1.000, 1.089).

2. **Forgetting srgbToLinear** — Calling rgb2xyz with the raw sRGB value
   instead of the linearised value. Symptom: sRGB white maps to
   xyz(0.45, 0.21, 0.07) instead of (0.95, 1.00, 1.09). All CIE spaces
   look subtly wrong, with colours shifted toward lower-left in the cube.

3. **Division by zero in xyz2xyY** — Black pixels have X=Y=Z=0. Without the
   `sum < 1e-6` guard, the shader produces NaN which some drivers render as
   a bright point at position (NaN, NaN, NaN) or crash the draw call entirely.

4. **labF declared after xyz2lab** — GLSL's single-pass parser sees a call to
   `labF` inside `xyz2lab` before `labF` is defined. Compile error: "undeclared
   identifier labF". Fix: move the labF function block above xyz2lab in the
   shaderConversions script.

5. **Density shader `discard;` stub not removed** — The stub discards every
   fragment, so the density cloud renders nothing. Symptom: switching to
   'density' mode shows an empty scene. Fix: remove the `discard;` stub and
   implement the Gaussian weight formula.

6. **depthWrite: true on density material** — With depth writing enabled, each
   splat records its depth. Later splats at the same screen position fail the
   depth test and are discarded, so only the front-most layer accumulates.
   The cloud looks dim and patchy rather than glowing. Fix: `depthWrite: false`.

7. **frustumCulled left as true** — The dummy position attribute (all zeros)
   makes Three.js compute a bounding sphere centred at the group origin with
   radius 0. When the camera moves away from the exact front-facing position,
   the sphere may leave the frustum and the entire cloud disappears. Fix:
   `frustumCulled = false` on every Points object.

8. **buildDataTexture returns 1×1 stub** — Until TODO 1 is complete, `loadImageSource`
   returns a minimal DataTexture. The points vertex shader samples the same single-pixel
   colour for every point, so all points pile at one position. Fix: implement the full
   canvas→getImageData→Float32Array→DataTexture pipeline in buildDataTexture.

9. **buildPointGeometry returns empty geometry** — Until TODO 2 is complete, all point
   clouds have zero vertices and nothing renders. This is the intended starting state.
   Fix: implement the UV grid loop and set both 'gridUV' and 'position' attributes.

10. **VideoTexture never updates** — Forgetting `video.muted = true` causes `video.play()`
    to throw an error (or return a rejected promise) due to browser autoplay policy. The
    video element exists but is not playing, so every frame the VideoTexture uploads the
    same empty frame. Fix: always set `video.muted = true` before calling `play()`.

11. **Video dimensions not known at creation time** — Accessing `video.videoWidth` before
    the `loadedmetadata` event fires returns 0. Calling `buildPointGeometry(0, 0, ...)` builds
    a geometry with zero vertices. Fix: always `await` the `loadedmetadata` Promise before
    reading video dimensions.

12. **Source switch rebuilds geometry when TODO 2 stub is still in place** — The geometry
    rebuild in TODO 17 calls `buildPointGeometry(w, h, ...)`. If TODO 2 has not been
    implemented yet, that function returns an empty `BufferGeometry`. This is safe (nothing
    crashes), but the cloud still shows nothing after the source switch. Fix: complete
    TODO 2 before testing the source selector.

---

## Step 9 — Video Input: Per-Frame Point Cloud Updates

### Why video is architecturally different from images

A JPEG is decoded once: you call `TextureLoader.loadAsync`, get back an HTMLImageElement,
draw it to a canvas, read pixels with `getImageData`, and upload a Float32 DataTexture to
the GPU. The texture never changes.

A video is a continuous stream of frames. The naïve approach — call `getImageData` on every
frame inside the animation loop — works but copies megabytes of pixel data from GPU → CPU →
GPU every 16 ms. On a 1920×1080 video that is roughly 8 MB of round-trip bandwidth per frame.
At 60 fps this saturates the PCIe bus and stalls the GPU pipeline.

Three.js's `VideoTexture` solves this. It wraps an `HTMLVideoElement` and exposes a
`needsUpdate` getter that returns `true` when a new decoded frame is available. Three.js
checks this getter before each draw call and, when `true`, calls `texSubImage2D` internally —
which copies the decoded bytes **directly from the browser's video decoder into a GPU texture**
with no CPU readback at all. The shader pipeline stays identical to the image path.

### THREE.VideoTexture internals

```
HTMLVideoElement (browser hardware decoder, 8-bit YUV → RGBA)
  │
  ▼  [texSubImage2D — GPU DMA, no CPU copy]
VideoTexture (sampler2D, 8-bit RGBA, auto-refreshed each render tick)
  │
  ▼  [pointsTex uniform]
pointsVertexShader
  │
  srgbToLinear()  ←  same path as DataTexture
  rgb2xyz() → xyz2lab() → ...
```

`VideoTexture.needsUpdate` is a JavaScript getter — NOT a plain property. Three.js reads it
before every draw call:

```js
// Three.js internals (simplified):
if (texture.needsUpdate) {
  gl.texSubImage2D(..., videoElement);  // zero-copy GPU upload
  texture.version++;
}
```

The getter body is approximately:
```js
get needsUpdate() {
  return this.source.data.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}
```

This means the texture only uploads a new frame if the browser has decoded one since the last
check. On a 24 fps video playing in a 60 fps render loop, the texture refreshes ~24 times per
second — the rest of the render ticks reuse the last uploaded frame at zero cost.

### The sRGB path: DataTexture vs VideoTexture

Both texture types deliver raw sRGB-encoded byte values (0–1) to the shader:

| | `loadImageSource` | `loadVideoSource` |
|---|---|---|
| Texture type | `DataTexture` (Float32) | `VideoTexture` (UInt8) |
| `colorSpace` tag | `SRGBColorSpace` | `NoColorSpace` |
| Shader receives | raw 0–1 sRGB bytes | raw 0–1 sRGB bytes |
| `srgbToLinear` needed? | ✅ yes | ✅ yes |
| Per-frame CPU work | none (static) | none (GPU DMA) |

Both paths land on `srgbToLinear(srgb)` as the first shader call. No GLSL changes are needed
when switching from image to video.

> **Why Float32 for images but UInt8 for video?**
> We use Float32 DataTexture for images because `getImageData` returns 8-bit integers (0–255)
> which we normalise to `[0, 1]` and store in a float array. We do this to avoid the WebGL
> hardware sRGB decode (which would apply gamma expansion before the shader sees the value,
> double-correcting it when `srgbToLinear` runs). For video, `VideoTexture` uses the browser's
> internal format (always 8-bit) and `NoColorSpace` disables hardware decode — the shader
> sees the same raw sRGB bytes.

### Setting up the video element

```js
const video = document.createElement('video');
video.muted       = true;        // REQUIRED: browser blocks unmuted autoplay
video.loop        = true;
video.playsInline = true;        // prevents mobile full-screen takeover
video.crossOrigin = 'anonymous'; // needed for cross-origin video files
video.src         = path;
```

You must `await` `loadedmetadata` before reading `video.videoWidth` / `video.videoHeight`:

```js
await new Promise(resolve =>
  video.addEventListener('loadedmetadata', resolve, { once: true })
);
// Now safe: video.videoWidth and video.videoHeight are non-zero
const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.NoColorSpace;
await video.play();
```

`{ once: true }` automatically removes the listener after it fires — no manual cleanup needed.

### Hot-swapping sources at runtime (TODO 17)

When the user switches from `'image'` to `'video'` in the GUI, three things must happen:

1. **Swap the flat-plane texture** — update `planeMesh.material.uniforms.tex.value`
2. **Swap the shader texture** — update `.pointsTex.value` on all cloud uniforms
3. **Rebuild geometry if dimensions changed** — if the video resolution differs from the
   image resolution, the UV grid (built by `buildPointGeometry`) must match the new dimensions

The `app` object holds `sourceW` and `sourceH` (set to the image dimensions at startup).
Compare these to the video dimensions and only rebuild when they actually differ:

```js
if (w !== app.sourceW || h !== app.sourceH) {
  app.sourceW = w;  app.sourceH = h;
  // rebuild directCloud, densityCloud, shadowCloud geometries …
  app.pointsUniforms.texSize.value.set(w, h);
}
```

### The render loop does not change

Once the VideoTexture is in place, the existing `animateExercise1` render loop handles
everything:

```js
function animate() {
  requestAnimationFrame(animate);
  app.controls.update();
  app.renderer.render(app.scene, app.camera); // Three.js checks VideoTexture.needsUpdate here
}
```

No code needs to be added inside the loop for video support. The GPU upload is implicit.

### Autoplay policy gotcha

Modern browsers enforce an autoplay policy: a page may not start audio or video playback
unless the user has interacted with the page (clicked, tapped, key-pressed). The policy
applies even to programmatic `video.play()` calls.

The **only reliable exception** is muted video. Setting `video.muted = true` before calling
`play()` guarantees autoplay is allowed in every major browser.

If you see a `DOMException: play() failed because the user didn't interact with the document
first`, it means either:
- `video.muted` was `false`, or
- The video was not served (404 / CORS error), so the browser cannot even start decoding

`play()` returns a `Promise`. Attach `.catch(console.error)` during development:
```js
await video.play().catch(console.error);
```

### Summary: what changes vs what does not

| Component | Image path | Video path |
|---|---|---|
| `loadImageSource` | used | replaced by `loadVideoSource` |
| GLSL shaders | unchanged | unchanged |
| `buildPointGeometry` | called once at startup | possibly called again when video dimensions differ |
| Animation loop | unchanged | unchanged |
| `pointsTex` uniform | Float32 DataTexture | VideoTexture (auto-updating) |

---

## Self-Assessment Rubric

Before considering the exercise complete, answer yes to every question:

- [ ] Can you switch between all six color spaces and see a clearly different
      geometric distribution of points in each one?
- [ ] In CIELAB mode, do achromatic greys cluster on the central vertical axis
      (a* ≈ 0, b* ≈ 0)?
- [ ] In CIELCH mode, orbiting the vertical axis reveals a cylindrical ring
      pattern of hues?
- [ ] In CIEXYZ mode, is sRGB white near position (0.5, 1.25, 0.5) in the
      bounding cube (top-far-right corner)?
- [ ] In density mode, do areas where many image pixels share a similar colour
      glow brighter than sparse regions?
- [ ] Does switching from 'direct' to 'density' in the GUI show only the
      density cloud (direct cloud hidden)?
- [ ] Does the shadow disappear when switching to density mode?
- [ ] After switching the 'Source' GUI control to 'video', does the flat plane
      display the video frames updating in real time?
- [ ] After switching to 'video', does the point cloud update per frame,
      showing the color distribution of each video frame in the color-space cube?
- [ ] In RGB mode with a video source, do moving objects in the video cause
      visible motion in the point cloud? (Pixels changing colour → points relocating.)
- [ ] If the video has different dimensions from the image, does the geometry
      rebuild automatically (confirmed by correct point density in the cube)?

---

## Relevant Links

- Three.js VideoTexture: https://threejs.org/docs/#api/en/textures/VideoTexture
- Three.js ShaderMaterial: https://threejs.org/docs/#api/en/materials/ShaderMaterial
- Three.js AdditiveBlending: https://threejs.org/docs/#api/en/constants/Materials
- IEC 61966-2-1 (sRGB standard): https://www.color.org/chardata/rgb/sRGB.xalter
- CIELAB color space (Wikipedia): https://en.wikipedia.org/wiki/CIELAB_color_space
- CIELCH and CIELAB relationship: https://en.wikipedia.org/wiki/HCL_color_space
- HTMLMediaElement.readyState: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/readyState
- Autoplay policy (Chrome): https://developer.chrome.com/blog/autoplay/
