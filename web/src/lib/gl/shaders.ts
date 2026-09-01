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
/** Which ply this vertex is a cut through, or -1 for a face that is not one. */
in float aPly;
/** That ply's fibre angle, radians. */
in float aFibre;

uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uBounds;

out vec3 vNormal;
out vec3 vWorld;
out float vT;
out float vPly;
out float vFibre;

void main() {
  vNormal = aNormal;
  vWorld = aPosition;
  // Constant across a ply strip, so nothing is interpolated between plies.
  vPly = aPly;
  vFibre = aFibre;
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
in float vPly;
in float vFibre;

uniform sampler2D uColormap;
uniform vec3 uEye;
/** What a point the core could not evaluate is painted with. */
uniform vec3 uHole;
/** The ply being evaluated, or -1 for none. */
uniform float uHighlightPly;
/** Hatch lines per world unit across the fibres. */
uniform float uHatchScale;

out vec4 fragColor;

/**
 * The fibre hatch on a cut edge.
 *
 * The phase runs ACROSS the fibres, so a cut along them shows continuous
 * lines and a cut across them shows them densely - which is what a section
 * through unidirectional material actually looks like, rather than a decorative
 * pattern whose angle has to be decoded. Anti-aliased through fwidth, or a ply
 * seen edge-on turns into moire.
 */
float fibreHatch(vec2 p, float angle) {
  vec2 across = vec2(-sin(angle), cos(angle));
  float phase = dot(p, across) * uHatchScale;
  float wave = abs(fract(phase) - 0.5) * 2.0;
  float width = max(fwidth(phase) * 1.5, 0.04);
  return 1.0 - smoothstep(0.0, width, wave);
}

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

  if (vPly >= 0.0) {
    // Darken along the hatch rather than painting a second colour on it: the
    // surface colour is carrying a result, and a hatch that replaced it would
    // be a second reading of the same pixels.
    base *= mix(1.0, 0.68, fibreHatch(vWorld.xy, vFibre));
    // The evaluated ply, lifted towards white so it reads through whatever
    // colour the result gave it.
    if (abs(vPly - uHighlightPly) < 0.5) {
      base = mix(base, vec3(1.0), 0.3);
    }
  }

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
