uniform sampler2D tex;
uniform float     scaleElevation;
uniform int       colorSpaceMode;
uniform int       channelIndex;
varying vec2      vUv;

void main() {
  vUv = uv;
  vec3 srgb = texture2D(tex, vUv).rgb;
  float h   = extractChannel(srgb, colorSpaceMode, channelIndex);
  vec3 pos  = position;
  pos.z    += h * scaleElevation;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
