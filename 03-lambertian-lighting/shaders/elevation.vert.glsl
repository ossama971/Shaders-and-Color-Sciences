uniform sampler2D tex;
uniform float     scaleElevation;
uniform int       colorSpaceMode;
uniform int       channelIndex;
uniform vec2      texelSize;

varying vec2 vUv;
varying vec3 vNormal;

float heightAt(vec2 uv) {
  vec3 s = texture2D(tex, uv).rgb;
  return extractChannel(s, colorSpaceMode, channelIndex) * scaleElevation;
}

void main() {
  vUv = uv;

  float hC = heightAt(vUv);
  vec3 pos = position;
  pos.z   += hC;

  float hR = heightAt(vUv + vec2( texelSize.x, 0.0));
  float hL = heightAt(vUv - vec2( texelSize.x, 0.0));
  float hU = heightAt(vUv + vec2(0.0,  texelSize.y));
  float hD = heightAt(vUv - vec2(0.0,  texelSize.y));

  vec3 tangentU = vec3(2.0 * texelSize.x, 0.0, hR - hL);
  vec3 tangentV = vec3(0.0, 2.0 * texelSize.y, hU - hD);
  vNormal = normalize(cross(tangentU, tangentV));

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
