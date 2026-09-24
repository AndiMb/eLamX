// The plate view drawn once, off screen, at a size and from a camera given
// rather than taken from a page - for the report's figures (P3.6).
//
// The same steps PlateView3D runs (assemble.ts) into the same scene, on a
// canvas that is never attached to the document, then composed with its
// legend and captions exactly as the view's own image export does. The
// context is given back at once: a browser keeps only a handful of WebGL
// contexts alive, and a report draws one per plate figure.

import type { ChartColors } from "../chartColors";
import { DEFAULT_ORBIT, type OrbitCamera } from "../gl/camera";
import type { BoundaryConditionId, StiffenerDto } from "../types";
import {
  parseCssColor,
  plateAnnotation,
  plateLoadArrows,
  plateScales,
  plateSceneStyle,
  type PlateViewLoad,
} from "./assemble";
import { buildPlateBody } from "./body";
import { buildColormap, type ColormapKind } from "./colormap";
import { canvasBlob, composePlateImage, type PlateImageLegend, type PlateImageStyle } from "./exportImage";
import { heightSampler } from "./loads";
import { autoBounds } from "./scale";
import { createPlateScene } from "./scene";

/** What to draw - the data props of PlateView3D. */
export interface PlateImageSpec {
  surface: number[][];
  length: number;
  width: number;
  thickness: number;
  plyBoundaries: number[];
  plyAngles?: number[];
  deflectionFraction: number;
  values?: (number | null)[][];
  bounds?: [number, number];
  scale?: ColormapKind;
  bcX?: BoundaryConditionId;
  bcY?: BoundaryConditionId;
  load?: PlateViewLoad;
  stiffeners?: readonly StiffenerDto[];
}

/** How to draw it. */
export interface PlateImageLook {
  colors: ChartColors;
  style: PlateImageStyle;
  legend: PlateImageLegend | null;
  captions: string[];
  /** The view's size in CSS pixels; the legend comes on top of the width. */
  size: { width: number; height: number };
  /** Device pixels per CSS pixel. */
  scale: number;
  camera?: OrbitCamera;
}

/** The view as a PNG, or null when the browser has no WebGL2 to draw it with. */
export async function renderPlateImage(spec: PlateImageSpec, look: PlateImageLook): Promise<Blob | null> {
  const width = Math.max(1, Math.round(look.size.width * look.scale));
  const height = Math.max(1, Math.round(look.size.height * look.scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const scene = createPlateScene(canvas);
  if (!scene) return null;
  try {
    const { surface, length, width: plateWidth, thickness } = spec;
    const kind = spec.scale ?? "diverging";
    const values =
      spec.values && spec.values.length === surface.length && spec.values[0]?.length === surface[0]?.length
        ? spec.values
        : undefined;
    const scales = plateScales(surface, length, plateWidth, thickness, spec.deflectionFraction);
    const body = buildPlateBody({
      surface,
      length,
      width: plateWidth,
      thickness,
      deflectionScale: scales.deflection,
      thicknessScale: scales.thickness,
      plyBoundaries: spec.plyBoundaries,
      plyAngles: spec.plyAngles,
      values,
    });
    const sampler = heightSampler(surface, scales.deflection, body.frame.scale);
    const arrows = plateLoadArrows(spec.load, body.frame, sampler);
    scene.setBody(body);
    scene.setHighlightedPly(null);
    scene.setValues(body.values, spec.bounds ?? autoBounds(values ?? surface, kind));
    scene.setAnnotation(plateAnnotation(body.frame, sampler, arrows, spec.bcX, spec.bcY, spec.stiffeners));
    scene.setColormap(buildColormap(look.colors, kind));
    scene.setStyle(plateSceneStyle(look.colors, parseCssColor(look.style.ink)));
    scene.setVisibility({ plyLines: true, outline: true, supports: true, loads: true, stiffeners: true });
    scene.setCamera(look.camera ?? DEFAULT_ORBIT);
    scene.renderAt(width, height);
    const sheet = composePlateImage(canvas, width, height, look);
    return sheet ? await canvasBlob(sheet) : null;
  } finally {
    scene.dispose();
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
