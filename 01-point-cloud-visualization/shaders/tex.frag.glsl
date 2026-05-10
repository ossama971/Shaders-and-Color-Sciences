uniform sampler2D tex;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(tex, vUv).rgb, 1.0);
}
