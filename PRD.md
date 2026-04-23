# PW2 Shaders and Color Sciences PRD

## 1. Purpose

This document translates `PW2-Shaders_and_Color_Sciences.pdf` into a build-ready product requirements document for this repository.

It captures:

- the mandatory assignment requirements
- the expected visual output inferred from the PDF reference figures
- the exercise-by-exercise milestones
- the current repository baseline
- the media, color-management, performance, and WebXR constraints needed to preserve appearance across photos and videos

## 2. Source of truth

Primary source:

- `PW2-Shaders_and_Color_Sciences.pdf`

Current repository baseline:

- `ex1_pointCloudVisualization.html`
- `ex1_pointCloudVisualization.js`
- `Assests/grenouille.jpg`
- `Assests/grenouille-gaus.jpg`

Reference material called out by the PDF:

- Three.js WebXR VR Sandbox: `https://threejs.org/examples/?q=vr#webxr_vr_sandbox`

## 3. Current repository baseline

The repository already contains a partial Exercise 1 prototype.

### Already present

- Three.js scene setup with custom GLSL shaders
- Desktop orbit-camera interaction
- Still-image point-cloud rendering from a JPEG
- Interactive switching between `RGB` and `HSV`
- Axis rendering, bounding cube, and point-cloud shadows
- Session-persisted UI settings
- Explicit sRGB-aware handling in the current image pipeline

### Missing relative to the brief

- `CIEXYZ`, `CIExyY`, `CIELAB`, and `CIELCH`
- Video input
- Density-based visualization mode
- Exercise 2 elevation maps
- Exercise 3 Lambertian lighting
- WebXR support for both VR and MR
- In-XR parameter controls
- One self-contained page per exercise beyond the current Exercise 1 prototype

### Baseline implication

The current code is a useful foundation for Exercise 1, especially for shader structure, point sampling, UI persistence, and color-pipeline discipline. It is not yet a complete submission.

## 4. Product objective

Build a set of three self-contained web applications, one per exercise, from a shared code base, using Three.js plus custom GLSL shaders to visualize color information extracted from either a still image or a video stream.

Each exercise must work in:

- desktop 3D mode
- VR via WebXR
- MR via WebXR

The final experience must preserve the visual appearance of the source media while enabling interactive exploration of six color spaces and multiple visualization modes.

## 5. Goals

- Accurately implement the six required color-space conversions in shader-driven rendering paths.
- Match or exceed the visual clarity suggested by the PDF reference figures.
- Support both photos and videos without visible color-management mistakes.
- Make all parameters usable both on desktop and inside XR sessions.
- Keep the applications responsive by using adaptive sampling and efficient GPU-oriented rendering paths.

## 6. Non-goals

- Offline scientific analysis tooling outside the web app
- Printer-oriented color management
- Full studio-grade support for every possible media color profile
- Replacing the assignment with a different visualization concept

## 7. Mandatory functional requirements

### 7.1 Shared requirements across all exercises

- Use custom GLSL shaders targeting WebGL through Three.js.
- Accept a source image or a video stream as input.
- Assume sRGB input unless a specific alternate encoding is detected and supported.
- Support six target color spaces:
  - `RGB`
  - `HSV`
  - `CIEXYZ`
  - `CIExyY`
  - `CIELAB`
  - `CIELCH`
- Provide interactive parameter control on desktop and inside XR.
- Use **lil-gui** as the control library for all in-scene desktop parameter panels (color space, visual mode, point density, shadow toggle, source selector).
- Use one self-contained web page per exercise.
- Keep the same shared code base across desktop, VR, and MR variants.
- Preserve appearance when switching between media types and visualization modes.

### 7.2 Exercise 1: color-space distribution visualization

Exercise 1 must provide two required visualization modes:

1. Direct point-cloud visualization
2. Density-based visualization

#### Functional requirements

- Render color distributions extracted from either an image or a video frame.
- Let the user switch interactively between all six color spaces.
- Keep axis labels and axis meaning correct for the selected space.
- Maintain a stable and readable camera framing for each space.
- Preserve original perceived colors in the rendered points or samples.
- Support desktop controls and XR controls for:
  - source selection
  - color-space selection
  - point density / sample density
  - density-view parameters
  - reset / recenter behavior
- Arrange the source-media texture display plane and the color-space bounding cube **side by side** along the horizontal axis, both facing the camera simultaneously.
- Render the texture display plane with **double-sided material** (`THREE.DoubleSide`) so it remains visible from any camera angle.
- Use a **perspective-correct dynamic point-size** formula (`gl_PointSize ∝ constant / depth`) with no hard upper cap, so points grow naturally as the camera zooms in; set `frustumCulled = false` on all point-cloud objects so individual points never disappear during close inspection.

#### Density-based requirement

The PDF does not prescribe a single density algorithm, but the PRD treats density-based output as mandatory. Acceptable implementation approaches include:

- additive point splatting
- Gaussian splatting
- 3D binning / voxel accumulation
- screen-space density accumulation

The chosen method must make high-occupancy regions easier to read than the raw point cloud while preserving color meaning.

### 7.3 Exercise 2: color elevation maps

Exercise 2 must turn color information into a heightfield surface.

#### Functional requirements

- For each pixel `(u, v)` in the source image or video frame, compute a chosen color component in a chosen color space.
- Use that component value as the height `z = h(u, v)`.
- Allow the user to choose:
  - source media
  - color space
  - component/channel used as height
  - vertical scale
  - mesh resolution / sampling density
- Update the elevation map continuously for video input.
- Keep the visualization interpretable in desktop, VR, and MR.

#### Output expectation

The surface should clearly reveal spatial variation in the selected component over the image domain. Geometry and coloring should remain legible even when the chosen component has low contrast.

### 7.4 Exercise 3: Lambertian lighting on elevation maps

Exercise 3 builds on Exercise 2 by adding directional diffuse lighting.

#### Functional requirements

- Apply a Lambertian directional lighting model to the elevation map.
- Estimate surface normals from the heightfield using finite differences.
- Support user control over:
  - light direction
  - light intensity / color
  - diffuse reflectance coefficient
  - optional ambient term
- Keep lighting behavior interactive for desktop and XR use.

#### Minimum shading model

`I = Id * kd * max(0, dot(N, L))`

Optional extension:

`I = Ia * ka + Id * kd * max(0, dot(N, L))`

## 8. Normative color conversion requirements

All exercises depend on a shared conversion pipeline. The PDF treats these formulas as required implementation references.

### 8.1 sRGB -> linear RGB

For each component `C` in `[0, 1]`:

```text
C_lin = C / 12.92                         if C <= 0.04045
C_lin = ((C + 0.055) / 1.055) ^ 2.4      otherwise
```

### 8.2 Linear RGB -> CIEXYZ

Use the D65 matrix:

```text
[X]   [0.4124564  0.3575761  0.1804375] [R_lin]
[Y] = [0.2126729  0.7151522  0.0721750] [G_lin]
[Z]   [0.0193339  0.1191920  0.9503041] [B_lin]
```

Reference white:

```text
(Xn, Yn, Zn) = (0.95047, 1.00000, 1.08883)
```

### 8.3 CIEXYZ -> CIExyY

```text
x = X / (X + Y + Z)
y = Y / (X + Y + Z)
Y = Y
```

If `X + Y + Z == 0`, use:

```text
(x, y, Y) = (0, 0, 0)
```

### 8.4 CIEXYZ -> CIELAB

Use:

```text
delta = 6 / 29

f(t) = t^(1/3)                 if t > delta^3
f(t) = t / (3 * delta^2) + 4/29 otherwise
```

Then:

```text
L* = 116 * f(Y / Yn) - 16
a* = 500 * (f(X / Xn) - f(Y / Yn))
b* = 200 * (f(Y / Yn) - f(Z / Zn))
```

### 8.5 CIELAB -> CIELCH

```text
C* = sqrt(a*^2 + b*^2)
h  = atan2(b*, a*)
```

### 8.6 RGB -> HSV

Let:

```text
Cmax = max(R, G, B)
Cmin = min(R, G, B)
Delta = Cmax - Cmin
```

Then:

```text
V = Cmax

S = 0                if Cmax == 0
S = Delta / Cmax     otherwise
```

Hue:

```text
H = 0 deg                                      if Delta == 0
H = 60 * (((G - B) / Delta) mod 360)             if Cmax == R
H = 60 * (((B - R) / Delta) + 2)               if Cmax == G
H = 60 * (((R - G) / Delta) + 4)               if Cmax == B
```

When used as a coordinate, normalize `H` to `[0, 1]` by dividing by `360`.

## 9. Visual expectations from the PDF reference figures

The PDF shows reference visualizations for three spaces:

- Figure 1: `RGB`
- Figure 2: `CIExyY`
- Figure 3: `CIELAB`

Each figure shows:

- a direct point-cloud visualization on the left
- a density-based visualization on the right

These figures are the qualitative benchmark for the final look and readability of the project.

### 9.1 Global visual expectations

- Visualizations must look intentional and presentation-ready, not like debug output.
- Axes must be labeled and correspond to the selected color-space components.
- The composition must make the distribution shape readable at a glance.
- Dense regions must remain readable rather than collapsing into noisy overdraw.
- Colors shown in the visualization must remain faithful to the source media.
- Camera framing, scene scale, and labeling must stay consistent enough that users can compare spaces.
- Both desktop and XR views must preserve the same visual logic.

### 9.2 RGB reference interpretation

Expected result:

- The direct point-cloud view should read as an axis-aligned distribution in RGB space.
- The density-based view should make the dominant color clusters more obvious than the raw cloud.
- Saturated source colors should remain vivid and easily identifiable.
- Neutral colors should remain near the grayscale diagonal trend rather than appearing arbitrarily shifted.

### 9.3 CIExyY reference interpretation

Expected result:

- The point distribution should no longer resemble a simple RGB cube.
- Chromaticity structure should dominate the visual form, with luminance separated into its own dimension.
- The density view should emphasize the fact that natural-image samples occupy only a subset of the theoretical space.

### 9.4 CIELAB reference interpretation

Expected result:

- Neutral colors should remain near the central opponent-color balance region.
- Lightness variation should remain readable and clearly distinct from chromatic spread.
- The density representation should look smoother and more perceptually organized than the raw cloud.

### 9.5 Extension to the remaining spaces

The PDF only illustrates three spaces, but the final work must extend the same visual quality standard to:

- `HSV`
- `CIEXYZ`
- `CIELCH`

For these spaces, the expected outcome is:

- correct axis semantics
- stable framing
- readable clusters
- faithful source-color appearance
- a density mode that clarifies the structure of the space

## 10. Media and color-management requirements

Appearance preservation is a first-class requirement.

### 10.1 Working-space rule

- Convert incoming display-referred media into a known working representation before applying color-space conversions.
- Avoid mixing encoded values and linear-light values in the same math path.
- Use one clearly defined linear working space for conversion math and one clearly defined display/output encoding for final presentation.

### 10.2 Still-image requirements

- Treat standard web JPEG and PNG inputs as sRGB unless metadata-aware handling says otherwise.
- Prevent double decoding or double gamma correction.
- Keep image sampling consistent between texture display and derived visualization geometry.

### 10.3 Video requirements

- Support live playback as a first-class input, not as an afterthought.
- Use a rendering path that avoids unnecessary CPU readback for every frame whenever possible.
- Preserve the apparent brightness, contrast, and saturation of the source video when switching between display view and derived visualization.
- Ensure that temporal updates do not introduce visible flicker or unstable color interpretation.

### 10.4 Different color encodings

At minimum, the system should be robust for common web media that is effectively delivered as sRGB or Rec.709-like RGB after browser decoding.

If the browser or media APIs expose broader-gamut or alternate encodings, the implementation should:

- normalize them into the chosen working space before conversion math
- preserve appearance instead of silently clipping or reinterpreting values
- avoid assuming that all videos behave exactly like still-image JPEGs

### 10.5 Acceptance rule for appearance preservation

If the same scene content is available as both a still frame and a video frame, the visualizations should not show obvious brightness, hue, or saturation mismatches caused by pipeline errors.

## 11. Performance and optimization requirements

The project must stay interactive on desktop and in XR.

### 11.1 Required optimization levers

- controllable sample density
- adaptive point budgets
- reduced density or shadow budgets where visually acceptable
- scalable mesh resolution for elevation maps
- separate quality presets for desktop and XR if needed

### 11.2 Still-image optimization expectations

- Large images should not force full-resolution sampling if it hurts interaction.
- Static media can afford preprocessing or cached GPU resources if it improves responsiveness.

### 11.3 Video optimization expectations

- Video should favor GPU-friendly updates and avoid heavy per-frame CPU reconstruction where possible.
- Quality should degrade gracefully under load rather than breaking interaction.
- Density-based and heightfield modes should expose tunable resolutions for live video.

### 11.4 XR optimization expectations

- XR mode may require more aggressive default sampling than desktop mode.
- UI interactions inside XR must remain responsive.
- Performance decisions must preserve the same overall visual logic even if sample counts differ.

## 12. Interaction and UX requirements

### Desktop UX

- Mouse/touch camera control
- Use **lil-gui** as the desktop control library; panel should be accessible without entering XR
- Clear, labelled parameter panel (color space, visual mode, point density, shadow, source)
- Fast switching between source media and visualization modes
- Reset / home view for each exercise

### XR UX

- In-XR parameter manipulation inspired by the Three.js WebXR VR Sandbox approach
- No dependency on leaving the XR session to adjust parameters
- Comfortable scale, readable text, and reachable controls
- Recenter / reset behavior that works inside the headset

## 13. Milestones

| Milestone                     | Outcome                                                                               | Key deliverables                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| M0 - Shared foundation        | Prepare shared media, color, and XR foundations from the current Exercise 1 prototype | Reusable loading path for image/video, shared color conversions, common control model, XR bootstrap                                      |
| M1 - Exercise 1 completion    | Finish color-space distribution visualizations                                        | Six spaces, point-cloud mode, density-based mode, desktop controls, XR controls, image + video support                                   |
| M2 - Exercise 2 completion    | Build color elevation maps                                                            | Heightfield generation, channel selection, media switching, scaling controls, desktop + XR support                                       |
| M3 - Exercise 3 completion    | Add Lambertian lighting on elevation maps                                             | Finite-difference normals, directional light controls, optional ambient term, desktop + XR support                                       |
| M4 - Validation and packaging | Make the submission presentable and traceable to the brief                            | Visual comparison to PDF references, color-pipeline checks, performance tuning, one self-contained page per exercise, repository cleanup |

## 14. Acceptance criteria

### 14.1 Shared acceptance criteria

- All three exercises exist as self-contained web pages.
- The same code base supports desktop, VR, and MR behavior in every exercise.
- All six color spaces are implemented correctly.
- Image and video inputs are both supported.
- Colors do not show obvious gamma or encoding mistakes.
- The UI remains usable on desktop and in XR.

### 14.2 Exercise 1 acceptance criteria

- Direct point-cloud visualization exists for all six spaces.
- Density-based visualization exists for all six spaces.
- Users can switch color spaces interactively.
- Users can compare visually meaningful structure across spaces.
- The output quality is comparable to the reference figures in readability and intent.

### 14.3 Exercise 2 acceptance criteria

- The surface height is driven by the selected component value.
- The user can change color space, component, and scale interactively.
- Video input updates the surface over time without breaking interaction.
- The resulting surfaces are readable and spatially informative.

### 14.4 Exercise 3 acceptance criteria

- Lambertian diffuse shading is visibly active on the elevation map.
- Normals are derived from heightfield differences rather than hard-coded.
- Lighting parameters can be adjusted interactively.
- The lighting improves depth perception compared with the unlit surface.

### 14.5 Visual benchmark criteria

- Axis labeling is correct and readable.
- Dense regions are legible in density mode.
- The visualizations feel like scientific / educational outputs, not temporary debugging views.
- The appearance remains consistent when moving from still images to videos and from desktop to XR.

## 15. Recommended repository outputs

Minimum expected outputs:

- `ex1_pointCloudVisualization.html` and its script(s)
- `ex2_colorElevationMaps.html` and its script(s)
- `ex3_lambertLighting.html` and its script(s)
- shared assets and shared utility code as needed

Optional but recommended:

- a shared module for color conversions and media input handling
- a shared XR UI helper layer
- reusable quality presets for desktop vs XR

## 16. Risks and implementation notes

- The largest technical risks are color-pipeline mistakes, video performance costs, and XR UI complexity.
- Density-based visualization is required, but the PDF does not mandate a single algorithm, so the implementation should choose the simplest method that clearly meets the visual benchmark.
- Web video color behavior may differ from still-image behavior; testing must include both.
- The current Exercise 1 prototype already shows good attention to sRGB handling and should be treated as the starting pattern for the shared media pipeline.

## 17. Definition of done

The project is done when:

- every PDF requirement is covered by a concrete implementation path
- the repo contains one self-contained page per exercise
- all three exercises work on desktop, VR, and MR
- the output visually aligns with the PDF examples
- photo and video appearance remain stable across the pipeline
- the repository is ready to submit as source code plus web pages
