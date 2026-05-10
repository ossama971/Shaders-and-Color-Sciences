uniform int  renderMode;
varying vec3 vColor;

void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;

  if (renderMode == 1) {
    float weight = 1.0 - (dist * 2.0);
    if (weight < 0.15) discard;
    gl_FragColor = vec4(vColor * weight, weight * 0.2);
  } else {
    gl_FragColor = vec4(vColor, 1.0);
  }
}
