// The two shader pairs the plate view draws with: a shaded surface and a flat
// line.
//
// The value reaches the fragment shader as a number, not a colour, and is
// turned into one by sampling a 256-entry lookup texture. That is what makes
// switching the colour scale (theme, scale bounds) a one-kilobyte texture
// upload instead of a rebuild of every vertex - and it is why the legend and
// the surface cannot drift apart: both read the same table.

export const SURFACE_VERTEX = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in float aValue;

uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uBounds;

out vec3 vNormal;
out vec3 vWorld;
out float vT;

void main() {
  vNormal = aNormal;
  vWorld = aPosition;
  float span = uBounds.y - uBounds.x;
  // Negative means "no answer here" - see HOLE in plateScene/body.ts. It
  // travels as a value rather than as a second attribute because it has to
  // survive interpolation: a triangle with one unevaluable corner should fade
  // into the hole, not pretend the whole face is missing.
  vT = aValue < -1.0e29 ? -1.0 : (span > 0.0 ? clamp((aValue - uBounds.x) / span, 0.0, 1.0) : 0.5);
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

export const SURFACE_FRAGMENT = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorld;
in float vT;

uniform sampler2D uColormap;
uniform vec3 uEye;
/** What a point the core could not evaluate is painted with. */
uniform vec3 uHole;

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(uEye - vWorld);

  // Two lights, both fixed to the camera rather than the world: a key light
  // slightly above and to the left, and a dim fill from below. A world-fixed
  // light leaves half the plate black once it is turned around, which reads as
  // missing data rather than as a lit object.
  vec3 side = normalize(cross(vec3(0.0, 0.0, 1.0), view));
  vec3 key = normalize(view + 0.45 * side + vec3(0.0, 0.0, 0.55));
  vec3 fill = normalize(view - 0.6 * side - vec3(0.0, 0.0, 0.8));

  // Two-sided: the underside of a plate is a real surface here, not a back
  // face to be discarded.
  float lambert = abs(dot(n, key)) * 0.78 + abs(dot(n, fill)) * 0.16;
  float ambient = 0.24;

  vec3 base = vT < 0.0 ? uHole : texture(uColormap, vec2(vT, 0.5)).rgb;
  vec3 color = base * (ambient + lambert);

  // A narrow specular gives the surface a material rather than a tint. Kept
  // low: it has to survive on a light background without washing out the
  // colour that carries the result.
  vec3 half_ = normalize(key + view);
  float spec = pow(max(dot(abs(n), half_), 0.0), 32.0) * 0.16;
  color += vec3(spec);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export const LINE_VERTEX = `#version 300 es
in vec3 aPosition;

uniform mat4 uView;
uniform mat4 uProjection;

void main() {
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

export const LINE_FRAGMENT = `#version 300 es
precision highp float;

uniform vec4 uColor;

out vec4 fragColor;

void main() {
  fragColor = uColor;
}
`;

// The annotation solids: support symbols and arrowheads. One flat colour from
// a uniform, shaded only enough to give a cone a silhouette with facets rather
// than a flat blob.
//
// The light is a headlight, and the shading takes `abs` of it: these are
// symbols to be read from every orbit angle, not a closed body with a
// well-defined inside, and a face that happens to be wound away from the eye
// must not go black.
export const ANNOTATION_VERTEX = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;

uniform mat4 uView;
uniform mat4 uProjection;

out vec3 vNormal;
out vec3 vWorld;

void main() {
  vNormal = aNormal;
  vWorld = aPosition;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

export const ANNOTATION_FRAGMENT = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorld;

uniform vec4 uColor;
uniform vec3 uEye;

out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(uEye - vWorld);
  float light = 0.62 + 0.38 * abs(dot(n, view));
  fragColor = vec4(uColor.rgb * light, uColor.a);
}
`;
