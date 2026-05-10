uniform sampler2D tex;
uniform vec3  lightDir;
uniform float Id;
uniform float kd;
uniform float Ia;
uniform float ka;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vec3 baseColor = texture2D(tex, vUv).rgb;
  vec3 N = normalize(vNormal);
  vec3 L = normalize(lightDir);

  float I = Ia * ka + Id * kd * max(0.0, dot(N, L));

  gl_FragColor = vec4(baseColor * I, 1.0);
}
