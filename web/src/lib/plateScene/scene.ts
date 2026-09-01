// The scene: buffers, programs, one draw.
//
// Deliberately not a React component and not React state. It is created once
// per canvas and held in a ref; effects push changes into it. The methods are
// split along how often what they carry actually changes - geometry rarely,
// values on every switch of the displayed quantity, the colour table on every
// theme change - so that switching what is shown uploads one float buffer
// instead of rebuilding a body, and so that the camera, which is only a matrix,
// never invalidates anything at all.

import { createGl, resizeToDisplay } from "../gl/context";
import { createProgram, type GlProgram } from "../gl/program";
import {
  ANNOTATION_FRAGMENT,
  ANNOTATION_VERTEX,
  LINE_FRAGMENT,
  LINE_VERTEX,
  SURFACE_FRAGMENT,
  SURFACE_VERTEX,
} from "../gl/shaders";
import {
  eyeOf,
  FAR_PLANE,
  FIELD_OF_VIEW,
  NEAR_PLANE,
  viewOf,
  type OrbitCamera,
} from "../gl/camera";
import { perspective } from "../gl/mat4";
import { EMPTY_MESH, type AnnotationMesh } from "./annotation";
import type { PlateBody } from "./body";

export type Rgba = [number, number, number, number];

export interface PlateSceneStyle {
  plyLines: Rgba;
  outline: Rgba;
  supports: Rgba;
  loads: Rgba;
  /** Points the core could not evaluate - a hole, not a value. */
  hole: Rgba;
}

export interface PlateSceneVisibility {
  plyLines: boolean;
  /** The undeformed reference geometry (FR-09). */
  outline: boolean;
  supports: boolean;
  loads: boolean;
}

/** What is drawn beside the plate itself: how it is held, and what pushes it. */
export interface PlateAnnotation {
  supports: AnnotationMesh;
  loads: AnnotationMesh;
}

export const NO_ANNOTATION: PlateAnnotation = { supports: EMPTY_MESH, loads: EMPTY_MESH };

export interface PlateScene {
  setBody(body: PlateBody): void;
  setAnnotation(annotation: PlateAnnotation): void;
  setValues(values: Float32Array, bounds: [number, number]): void;
  setColormap(table: Uint8Array): void;
  setCamera(camera: OrbitCamera): void;
  setStyle(style: PlateSceneStyle): void;
  setVisibility(visibility: PlateSceneVisibility): void;
  render(): void;
  dispose(): void;
}

export function createPlateScene(canvas: HTMLCanvasElement): PlateScene | null {
  const gl = createGl(canvas);
  if (!gl) return null;

  let surfaceProgram: GlProgram;
  let lineProgram: GlProgram;
  let annotationProgram: GlProgram;
  try {
    surfaceProgram = createProgram(gl, SURFACE_VERTEX, SURFACE_FRAGMENT);
    lineProgram = createProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
    annotationProgram = createProgram(gl, ANNOTATION_VERTEX, ANNOTATION_FRAGMENT);
  } catch {
    // A driver that reports WebGL2 but cannot compile these shaders is not a
    // case to work around; the caller falls back to the 2D view.
    return null;
  }

  const positionBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();
  const valueBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  const plyBuffer = gl.createBuffer();
  const outlineBuffer = gl.createBuffer();

  const solidVao = gl.createVertexArray();
  const plyVao = gl.createVertexArray();
  const outlineVao = gl.createVertexArray();
  const colormap = gl.createTexture();

  // Supports and loads are two groups because they are two colours; each is a
  // lit solid (symbols, arrowheads) plus flat lines (hatching, dashes, shafts).
  const supports = createLayer(gl, annotationProgram, lineProgram);
  const loads = createLayer(gl, annotationProgram, lineProgram);

  gl.bindTexture(gl.TEXTURE_2D, colormap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Vertex layout is fixed at creation; only the buffer contents change.
  gl.bindVertexArray(solidVao);
  bindFloatAttribute(gl, positionBuffer, surfaceProgram.attrib("aPosition"), 3);
  bindFloatAttribute(gl, normalBuffer, surfaceProgram.attrib("aNormal"), 3);
  bindFloatAttribute(gl, valueBuffer, surfaceProgram.attrib("aValue"), 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

  gl.bindVertexArray(plyVao);
  bindFloatAttribute(gl, plyBuffer, lineProgram.attrib("aPosition"), 3);

  gl.bindVertexArray(outlineVao);
  bindFloatAttribute(gl, outlineBuffer, lineProgram.attrib("aPosition"), 3);

  gl.bindVertexArray(null);

  let indexCount = 0;
  let plyVertexCount = 0;
  let outlineVertexCount = 0;
  let bounds: [number, number] = [-1, 1];
  let camera: OrbitCamera = { azimuth: 0, elevation: 0.9, distance: 2.6 };
  let style: PlateSceneStyle = {
    plyLines: [0, 0, 0, 0.35],
    outline: [0.5, 0.5, 0.5, 0.5],
    supports: [0.45, 0.45, 0.45, 1],
    loads: [0.2, 0.45, 0.8, 1],
    hole: [0.6, 0.6, 0.6, 1],
  };
  let visibility: PlateSceneVisibility = {
    plyLines: true,
    outline: true,
    supports: true,
    loads: true,
  };

  return {
    // Geometry only. The values live in their own buffer and their own call,
    // because they change on their own schedule - see the note at the top.
    setBody(body) {
      upload(gl, positionBuffer, body.positions);
      upload(gl, normalBuffer, body.normals);

      gl.bindVertexArray(solidVao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, body.indices, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      indexCount = body.indices.length;

      upload(gl, plyBuffer, body.plyLines);
      plyVertexCount = body.plyLines.length / 3;

      upload(gl, outlineBuffer, body.outline);
      outlineVertexCount = body.outline.length / 3;
    },

    // Rebuilt only when the plate, its edges or its loads change - never when
    // the camera moves, and never when the displayed quantity does.
    setAnnotation(annotation) {
      supports.upload(annotation.supports);
      loads.upload(annotation.loads);
    },

    setValues(values, nextBounds) {
      upload(gl, valueBuffer, values);
      bounds = nextBounds;
    },

    setColormap(table) {
      gl.bindTexture(gl.TEXTURE_2D, colormap);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        table.length / 4,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        table,
      );
    },

    setCamera(next) {
      camera = next;
    },

    setStyle(next) {
      style = next;
    },

    setVisibility(next) {
      visibility = next;
    },

    render() {
      resizeToDisplay(gl, canvas);
      const aspect = canvas.width / Math.max(1, canvas.height);
      const projection = perspective(FIELD_OF_VIEW, aspect, NEAR_PLANE, FAR_PLANE);
      const view = viewOf(camera);
      const eye = eyeOf(camera);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (indexCount > 0) {
        gl.useProgram(surfaceProgram.handle);
        gl.uniformMatrix4fv(surfaceProgram.uniform("uProjection"), false, projection);
        gl.uniformMatrix4fv(surfaceProgram.uniform("uView"), false, view);
        gl.uniform2f(surfaceProgram.uniform("uBounds"), bounds[0], bounds[1]);
        gl.uniform3f(surfaceProgram.uniform("uEye"), eye[0], eye[1], eye[2]);
        gl.uniform3f(surfaceProgram.uniform("uHole"), style.hole[0], style.hole[1], style.hole[2]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, colormap);
        gl.uniform1i(surfaceProgram.uniform("uColormap"), 0);

        // Push the filled surface back by a fraction of a depth unit so the ply
        // interfaces drawn on it win the depth test. Offsetting the lines
        // towards the camera instead would lift them off the body at grazing
        // angles.
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);
        gl.bindVertexArray(solidVao);
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }

      if (supports.solidCount + loads.solidCount > 0) {
        gl.useProgram(annotationProgram.handle);
        gl.uniformMatrix4fv(annotationProgram.uniform("uProjection"), false, projection);
        gl.uniformMatrix4fv(annotationProgram.uniform("uView"), false, view);
        gl.uniform3f(annotationProgram.uniform("uEye"), eye[0], eye[1], eye[2]);
        if (visibility.supports) supports.drawSolid(annotationProgram, style.supports);
        if (visibility.loads) loads.drawSolid(annotationProgram, style.loads);
      }

      gl.useProgram(lineProgram.handle);
      gl.uniformMatrix4fv(lineProgram.uniform("uProjection"), false, projection);
      gl.uniformMatrix4fv(lineProgram.uniform("uView"), false, view);

      if (visibility.supports) supports.drawLines(lineProgram, style.supports);
      if (visibility.loads) loads.drawLines(lineProgram, style.loads);

      if (visibility.plyLines && plyVertexCount > 0) {
        gl.uniform4fv(lineProgram.uniform("uColor"), style.plyLines);
        gl.bindVertexArray(plyVao);
        gl.drawArrays(gl.LINES, 0, plyVertexCount);
      }

      if (visibility.outline && outlineVertexCount > 0) {
        gl.uniform4fv(lineProgram.uniform("uColor"), style.outline);
        gl.bindVertexArray(outlineVao);
        gl.drawArrays(gl.LINES, 0, outlineVertexCount);
      }

      gl.bindVertexArray(null);
    },

    dispose() {
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(valueBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteBuffer(plyBuffer);
      gl.deleteBuffer(outlineBuffer);
      supports.dispose();
      loads.dispose();
      gl.deleteVertexArray(solidVao);
      gl.deleteVertexArray(plyVao);
      gl.deleteVertexArray(outlineVao);
      gl.deleteTexture(colormap);
      surfaceProgram.dispose();
      lineProgram.dispose();
      annotationProgram.dispose();
    },
  };
}

/** How much of its colour an annotation keeps where the plate hides it. */
const GHOST_ALPHA = 0.22;

/**
 * One annotation group: a lit solid mesh and a set of flat lines, both in one
 * colour.
 *
 * Two vertex arrays rather than one, because the two are drawn by two
 * different programs and an attribute layout belongs to the program that reads
 * it.
 *
 * Each is drawn twice. The second pass is the ordinary one; the first inverts
 * the depth test to paint, faintly, exactly the parts the plate hides. Without
 * it a load that pushes UPWARDS is invisible in the default view - its arrows
 * are correct, under the plate, inside the bowl the plate has just bent into -
 * and the picture then shows a plate with no load on it. Ghosting is also what
 * a section drawing does with a hidden edge, so it reads as "behind" rather
 * than as a second kind of arrow.
 */
function createLayer(gl: WebGL2RenderingContext, solidProgram: GlProgram, lineProgram: GlProgram) {
  const positionBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();
  const lineBuffer = gl.createBuffer();
  const solidVao = gl.createVertexArray();
  const lineVao = gl.createVertexArray();

  gl.bindVertexArray(solidVao);
  bindFloatAttribute(gl, positionBuffer, solidProgram.attrib("aPosition"), 3);
  bindFloatAttribute(gl, normalBuffer, solidProgram.attrib("aNormal"), 3);

  gl.bindVertexArray(lineVao);
  bindFloatAttribute(gl, lineBuffer, lineProgram.attrib("aPosition"), 3);
  gl.bindVertexArray(null);

  let solidCount = 0;
  let lineCount = 0;

  return {
    get solidCount() {
      return solidCount;
    },

    upload(mesh: AnnotationMesh) {
      upload(gl, positionBuffer, mesh.positions);
      upload(gl, normalBuffer, mesh.normals);
      upload(gl, lineBuffer, mesh.lines);
      solidCount = mesh.positions.length / 3;
      lineCount = mesh.lines.length / 3;
    },

    drawSolid(program: GlProgram, color: Rgba) {
      if (solidCount === 0) return;
      gl.bindVertexArray(solidVao);
      twice(gl, program, color, () => gl.drawArrays(gl.TRIANGLES, 0, solidCount));
    },

    drawLines(program: GlProgram, color: Rgba) {
      if (lineCount === 0) return;
      gl.bindVertexArray(lineVao);
      twice(gl, program, color, () => gl.drawArrays(gl.LINES, 0, lineCount));
    },

    dispose() {
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(lineBuffer);
      gl.deleteVertexArray(solidVao);
      gl.deleteVertexArray(lineVao);
    },
  };
}

/**
 * Draws the bound geometry hidden-first, then visible.
 *
 * The hidden pass writes no depth: it must not stop the visible pass that
 * follows it, and it must not make one ghosted arrow occlude the next.
 */
function twice(
  gl: WebGL2RenderingContext,
  program: GlProgram,
  color: Rgba,
  draw: () => void,
) {
  gl.depthFunc(gl.GREATER);
  gl.depthMask(false);
  gl.uniform4f(program.uniform("uColor"), color[0], color[1], color[2], color[3] * GHOST_ALPHA);
  draw();

  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  gl.uniform4fv(program.uniform("uColor"), color);
  draw();
}

function bindFloatAttribute(
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer | null,
  location: number,
  size: number,
) {
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function upload(gl: WebGL2RenderingContext, buffer: WebGLBuffer | null, data: Float32Array) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
}
