varying float vAlpha;

void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha * (1.0 - dist * 2.0));
}
