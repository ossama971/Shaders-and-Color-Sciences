vec3 srgbToLinear(vec3 c) {
  vec3 low  = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), c));
}

vec3 rgb2hsv(vec3 c) {
  float Cmax  = max(c.r, max(c.g, c.b));
  float Cmin  = min(c.r, min(c.g, c.b));
  float Delta = Cmax - Cmin;
  float V = Cmax;
  float S = (Cmax < 1e-6) ? 0.0 : Delta / Cmax;
  float H = 0.0;
  if (Delta > 1e-6) {
    if      (Cmax == c.r) { H = 60.0 * mod((c.g - c.b) / Delta, 6.0); }
    else if (Cmax == c.g) { H = 60.0 * ((c.b - c.r) / Delta + 2.0);   }
    else                  { H = 60.0 * ((c.r - c.g) / Delta + 4.0);   }
    H /= 360.0;
  }
  return vec3(H, S, V);
}

vec3 rgb2xyz(vec3 rgb) {
  vec3 linear = srgbToLinear(rgb);
  mat3 m = mat3(
    0.4124564, 0.2126729, 0.0193339,
    0.3575761, 0.7151522, 0.1191920,
    0.1804375, 0.0721750, 0.9503041
  );
  return m * linear;
}

vec3 xyz2xyY(vec3 xyz) {
  float sum = xyz.x + xyz.y + xyz.z;
  if (sum < 1e-6) return vec3(0.0);
  return vec3(xyz.x / sum, xyz.y / sum, xyz.y);
}

float labF(float t) {
  float delta = 6.0 / 29.0;
  float d3    = delta * delta * delta;
  return t > d3 ? pow(t, 1.0 / 3.0) : (t / (3.0 * delta * delta) + 4.0 / 29.0);
}

vec3 xyz2lab(vec3 xyz) {
  const float Xn = 0.95047;
  const float Yn = 1.00000;
  const float Zn = 1.08883;
  float fx = labF(xyz.x / Xn);
  float fy = labF(xyz.y / Yn);
  float fz = labF(xyz.z / Zn);
  return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

vec3 lab2lch(vec3 lab) {
  float C = length(vec2(lab.y, lab.z));
  float h = atan(lab.z, lab.y);
  if (h < 0.0) h += 6.28318530;
  return vec3(lab.x, C, h / 6.28318530);
}

/* colorSpace: 0=RGB 1=HSV 2=CIEXYZ 3=CIExyY 4=CIELAB 5=CIELCH
   channel:    0/1/2 = first/second/third component              */
float extractChannel(vec3 srgb, int colorSpace, int channel) {
  vec3 c;
  if      (colorSpace == 0) { c = srgb; }
  else if (colorSpace == 1) { c = rgb2hsv(srgb); }
  else if (colorSpace == 2) {
    vec3 xyz = rgb2xyz(srgb);
    c = vec3(clamp(xyz.x/0.95047,0.0,1.0), clamp(xyz.y,0.0,1.0), clamp(xyz.z/1.08883,0.0,1.0));
  }
  else if (colorSpace == 3) { c = xyz2xyY(rgb2xyz(srgb)); }
  else if (colorSpace == 4) {
    vec3 lab = xyz2lab(rgb2xyz(srgb));
    c = vec3(lab.x/100.0, (lab.y+128.0)/255.0, (lab.z+128.0)/255.0);
  }
  else {
    vec3 lch = lab2lch(xyz2lab(rgb2xyz(srgb)));
    c = vec3(lch.x/100.0, clamp(lch.y/150.0,0.0,1.0), lch.z);
  }
  float v = (channel==0) ? c.x : (channel==1) ? c.y : c.z;
  return clamp(v, 0.0, 1.0);
}
