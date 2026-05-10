uniform sampler2D pointsTex;
uniform int       colorSpaceMode;
uniform float     shadowY;
attribute vec2    gridUV;
varying float     vAlpha;

void main() {
  vec3 srgb = texture2D(pointsTex, gridUV).rgb;
  vec3 pos;

  if (colorSpaceMode == 1) {
    vec3 hsv = rgb2hsv(srgb);
    pos    = vec3(hsv.x - 0.5, shadowY, hsv.y - 0.5);
    vAlpha = 0.25 * hsv.z;
  } else {
    pos    = vec3(srgb.r - 0.5, shadowY, srgb.g - 0.5);
    vAlpha = 0.25 * srgb.b;
  }

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = clamp(3.0 * (120.0 / -mvPos.z), 1.5, 4.0);
  gl_Position  = projectionMatrix * mvPos;
}
