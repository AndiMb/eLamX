// Shader compilation, with the locations looked up once.
//
// Errors throw rather than return null: a shader that does not compile is a
// programming mistake, not a runtime condition, and the caller's fallback path
// is for machines without WebGL - not for a typo in GLSL. The info log is
// carried in the message because without it "link failed" says nothing.

export interface GlProgram {
  handle: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
  attrib(name: string): number;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compilation failed: ${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): GlProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const handle = gl.createProgram();
  if (!handle) throw new Error("could not create program");

  gl.attachShader(handle, vertex);
  gl.attachShader(handle, fragment);
  gl.linkProgram(handle);
  // The shaders are referenced by the linked program until it is deleted, so
  // they can go now - keeping them would leak one pair per rebuild.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle);
    gl.deleteProgram(handle);
    throw new Error(`program link failed: ${log}`);
  }

  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const attribs = new Map<string, number>();

  return {
    handle,
    uniform(name) {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(handle, name));
      return uniforms.get(name) ?? null;
    },
    attrib(name) {
      if (!attribs.has(name)) attribs.set(name, gl.getAttribLocation(handle, name));
      return attribs.get(name) ?? -1;
    },
    dispose() {
      gl.deleteProgram(handle);
    },
  };
}
