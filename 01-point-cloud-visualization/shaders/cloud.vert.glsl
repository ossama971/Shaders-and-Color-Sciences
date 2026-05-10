uniform sampler2D pointsTex;
uniform vec2      texSize;
uniform int       colorSpaceMode;
uniform float     pointSizeBase;
attribute vec2    gridUV;
varying vec3      vColor;

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
    float nx = clamp(xyz.x / 0.95047, 0.0, 1.0);
    float ny = clamp(xyz.y / 1.00000, 0.0, 1.0);
    float nz = clamp(xyz.z / 1.08883, 0.0, 1.0);
    pos = vec3(nx - 0.5, ny + 0.25, nz - 0.5);
  } else if (colorSpaceMode == 3) {
    vec3 xyY = xyz2xyY(rgb2xyz(srgb));
    pos = vec3(xyY.x - 0.5, xyY.z + 0.25, xyY.y - 0.5);
  } else if (colorSpaceMode == 4) {
    vec3 lab = xyz2lab(rgb2xyz(srgb));
    pos = vec3(
      lab.y / 200.0,
      (lab.x - 50.0) / 100.0 + 0.75,
      lab.z / 200.0
    );
  } else {
    vec3 lch = lab2lch(xyz2lab(rgb2xyz(srgb)));
    pos = vec3(
      clamp(lch.y / 100.0, 0.0, 1.0) - 0.5,
      lch.x / 100.0 + 0.25,
      lch.z - 0.5
    );
  }

  vColor = srgb;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = max(pointSizeBase / -mvPos.z, 1.0);
  gl_Position  = projectionMatrix * mvPos;
}
