import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { createPlateScene, type PlateScene } from "../../lib/plateScene/scene";
import { buildPlateBody } from "../../lib/plateScene/body";
import { buildColormap, rgbaOf, type ColormapKind } from "../../lib/plateScene/colormap";
import { EMPTY_MESH } from "../../lib/plateScene/annotation";
import { supportEdges, supportMesh } from "../../lib/plateScene/supports";
import {
  edgeFlowArrows,
  heightSampler,
  type HeightAt,
  loadMesh,
  NO_LOADS,
  transverseLoadArrows,
} from "../../lib/plateScene/loads";
import {
  autoBounds,
  autoDeflectionScale,
  autoThicknessScale,
  peakOf,
} from "../../lib/plateScene/scale";
import {
  clampDistance,
  DEFAULT_ORBIT,
  orbitAfterDrag,
  projectToScreen,
  screenDirectionOf,
  STANDARD_VIEWS,
  viewProjectionOf,
  type OrbitCamera,
} from "../../lib/gl/camera";
import { pickPlate } from "../../lib/gl/pick";
import { useChartColors } from "../../lib/chartColors";
import { formatSignificant } from "../../lib/numberFormat";
import { BucklingPlate3D } from "./BucklingPlate3D";
import {
  PlateViewOverlay,
  type PlateViewAxis,
  type PlateViewCaption,
  type PlateViewLayers,
  type PlateViewMarker,
} from "./PlateViewOverlay";
import type { BoundaryConditionId, NamedLoadDto } from "../../lib/types";
import { useLocale, useT } from "../../i18n";

// The plate as a solid body: real laminate thickness, visible ply interfaces,
// lit rather than flat-filled, and - since the annotation landed - how it is
// held and what pushes it. Draws through WebGL2, because the painter's
// algorithm the 2D view uses is only exact while the scene is a single-valued
// height field, and support blocks and load arrows cross that field the moment
// they appear.
//
// The 2D view stays as the fallback for machines without WebGL2. It is exactly
// the case where sorting quads by depth is still correct, so what it can draw,
// it draws right - which now means the body alone.

/** What is pushing on the plate: the two modules load it differently. */
export type PlateViewLoad =
  | { kind: "transverse"; loads: readonly NamedLoadDto[] }
  | { kind: "inPlane"; nx: number; ny: number; nxy: number };

export interface PlateView3DProps {
  /** Deflection field, rows along y, columns along x. */
  surface: number[][];
  /** Plate extent in x. */
  length: number;
  /** Plate extent in y. */
  width: number;
  /** Total laminate thickness, same unit as the plate extents. */
  thickness: number;
  /** Ply interfaces as fractions of the thickness, -0.5 to +0.5, ascending. */
  plyBoundaries: number[];
  /** Fibre angle of each ply in radians, bottom-up - one fewer than there are
   *  boundaries. Hatched onto the cut edge. */
  plyAngles?: number[];
  /** The ply whose result is being shown, lifted out of the stack (FR-02). */
  highlightPly?: number | null;
  /** Peak deflection as a fraction of the shorter edge. */
  deflectionFraction: number;
  /**
   * What to colour the body by, on the SAME grid as `surface`. Omitted, the
   * deflection colours itself, which is what the buckling module wants.
   */
  values?: (number | null)[][];
  /** Colour scale limits. Omitted, they follow the values (FR-05). */
  bounds?: [number, number];
  /** Diverging about zero, or sequential. See `plateFields.ts`. */
  scale?: ColormapKind;
  /** Condition of the two edges normal to x; omitted, no supports are drawn. */
  bcX?: BoundaryConditionId;
  /** Condition of the two edges normal to y. */
  bcY?: BoundaryConditionId;
  /**
   * What loads the plate. Hold this stable across renders - a fresh object
   * every time would rebuild the arrows and re-upload their buffers for a
   * picture that did not change.
   */
  load?: PlateViewLoad;
  /**
   * Which annotation layers are drawn. Owned by the caller so the choice can
   * be persisted per laminate (FR-12) rather than resetting every time the
   * module is left.
   */
  layers: PlateViewLayers;
  onToggleLayer: (layer: keyof PlateViewLayers) => void;
  /**
   * Extremes of the displayed field, marked where they sit (FR-11). Positions
   * are plate coordinates from the corner at (0, 0), in the plate's own unit.
   */
  markers?: { at: [number, number]; text: string; kind: "min" | "max" }[];
  /**
   * What to write under the pointer. Given the point in plate coordinates and
   * the value there, or null where the field could not be evaluated.
   *
   * A callback rather than a formatted string, because the unit belongs to the
   * quantity being shown and this component does not know which one that is.
   */
  readoutText?: (probe: { x: number; y: number; value: number | null }) => string;
  ariaLabel: string;
}

export const PlateView3D = memo(function PlateView3D({
  surface,
  length,
  width,
  thickness,
  plyBoundaries,
  plyAngles,
  highlightPly = null,
  deflectionFraction,
  values,
  bounds,
  scale = "diverging",
  bcX,
  bcY,
  load,
  layers,
  onToggleLayer,
  markers,
  readoutText,
  ariaLabel,
}: PlateView3DProps) {
  const t = useT();
  const locale = useLocale();
  const colors = useChartColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<PlateScene | null>(null);
  const frame = useRef<number | null>(null);
  const [supported, setSupported] = useState(true);
  // Bumped to rebuild the scene after the driver takes the context away.
  const [generation, setGeneration] = useState(0);
  const [camera, setCamera] = useState<OrbitCamera>(DEFAULT_ORBIT);
  // The captions are placed by the same projection the canvas draws with, so
  // they need the size the canvas is actually shown at.
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Where the pointer last met the plate, or null when it was off it.
  const [probe, setProbe] = useState<{ u: number; v: number; x: number; y: number } | null>(null);

  const drag = useRef<{ x: number; y: number; camera: OrbitCamera } | null>(null);
  const pinch = useRef<{ distance: number; cameraDistance: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Arrays as props are new objects on every render; the effects below key off
  // these instead, so a recomputed-but-identical field does not rebuild a body.
  const plyKey = plyBoundaries.join(",");
  const angleKey = plyAngles?.join(",") ?? "";

  // A field that does not match the body it would colour is one frame of a
  // switch in flight - the two grids are separate async atoms and the coarser
  // reserve-factor grid arrives before or after its geometry. Dropping it for
  // that frame shows the previous colouring rather than a body full of holes.
  const colours = useMemo(
    () =>
      values && values.length === surface.length && values[0]?.length === surface[0]?.length
        ? values
        : undefined,
    [values, surface],
  );

  const scales = useMemo(() => {
    const peak = peakOf(surface);
    return {
      deflection: autoDeflectionScale(peak, length, width, deflectionFraction),
      thickness: autoThicknessScale(thickness, length, width),
    };
  }, [surface, length, width, thickness, deflectionFraction]);

  const body = useMemo(
    () =>
      buildPlateBody({
        surface,
        length,
        width,
        thickness,
        deflectionScale: scales.deflection,
        thicknessScale: scales.thickness,
        plyBoundaries,
        plyAngles,
        values: colours,
      }),
    // plyBoundaries is covered by plyKey; listing it would rebuild on identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, length, width, thickness, plyKey, angleKey, scales, colours],
  );

  // The drawn mid-surface, shared by the load arrows and the pointer probe:
  // both have to land on the body the reader can see, not on the flat plate.
  const sampler = useMemo<HeightAt>(
    () => heightSampler(surface, scales.deflection, body.frame.scale),
    [surface, scales.deflection, body.frame.scale],
  );

  // The arrows are kept as arrows rather than only as triangles, because the
  // captions have to be anchored to the same points the heads sit on.
  const loadArrows = useMemo(() => {
    if (!load) return NO_LOADS;
    if (load.kind === "inPlane") {
      return edgeFlowArrows(load.nx, load.ny, load.nxy, body.frame);
    }
    return transverseLoadArrows(load.loads, body.frame, sampler);
  }, [load, body, sampler]);

  const annotation = useMemo(
    () => ({
      supports:
        bcX && bcY ? supportMesh(supportEdges(bcX, bcY, body.frame), body.frame) : EMPTY_MESH,
      loads: loadMesh(loadArrows),
    }),
    [bcX, bcY, body, loadArrows],
  );

  const requestRender = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      sceneRef.current?.render();
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createPlateScene(canvas);
    if (!scene) {
      setSupported(false);
      return;
    }
    sceneRef.current = scene;
    setSupported(true);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [generation]);

  // Without preventDefault the browser will not fire `webglcontextrestored`,
  // and the view stays a blank rectangle after a driver reset with no hint why.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      sceneRef.current = null;
    };
    const onRestored = () => setGeneration((value) => value + 1);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setBody(body);
    scene.setHighlightedPly(highlightPly);
    scene.setValues(body.values, bounds ?? autoBounds(colours ?? surface, scale));
    requestRender();
  }, [body, surface, colours, bounds, scale, highlightPly, generation, requestRender]);

  useEffect(() => {
    sceneRef.current?.setAnnotation(annotation);
    requestRender();
  }, [annotation, generation, requestRender]);

  useEffect(() => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    scene.setColormap(buildColormap(colors, scale));
    // The line colours come from the canvas's own inherited `color`, which
    // App.css points at the same token the 2D charts use - one place decides
    // what "ink" means in either theme. The annotation is the exception: it
    // must not be readable as a value on the colour scale, so it takes two
    // roles of its own.
    const ink = parseCssColor(getComputedStyle(canvas).color);
    scene.setStyle({
      plyLines: [ink[0], ink[1], ink[2], 0.5],
      outline: [ink[0], ink[1], ink[2], 0.35],
      supports: rgbaOf(colors.annotation.support),
      loads: rgbaOf(colors.annotation.load),
      hole: [ink[0], ink[1], ink[2], 1],
    });
    requestRender();
  }, [colors, scale, generation, requestRender]);

  useEffect(() => {
    sceneRef.current?.setVisibility({
      plyLines: true,
      outline: layers.reference,
      supports: layers.supports,
      loads: layers.loads,
    });
    requestRender();
  }, [layers, generation, requestRender]);

  useEffect(() => {
    sceneRef.current?.setCamera(camera);
    requestRender();
  }, [camera, generation, requestRender]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      // Returning the same object when nothing moved keeps this out of a
      // render loop: a ResizeObserver that always sets state would schedule a
      // layout that schedules the observer again.
      setCanvasSize((current) =>
        current.width === canvas.clientWidth && current.height === canvas.clientHeight
          ? current
          : { width: canvas.clientWidth, height: canvas.clientHeight },
      );
      requestRender();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(() => {
    return () => {
      if (frame.current === null) return;
      cancelAnimationFrame(frame.current);
      // Clearing the handle matters as much as cancelling it. A cancelled frame
      // never runs its callback, so nothing else resets this - and while it
      // holds a stale id, every later requestRender short-circuits and the view
      // stays blank for good. StrictMode's mount-cleanup-mount makes that the
      // normal case rather than an edge one.
      frame.current = null;
    };
  }, []);

  // React's onWheel is passive and cannot preventDefault, so the page would
  // scroll while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setCamera((current) => ({
        ...current,
        distance: clampDistance(current.distance * (event.deltaY < 0 ? 1 / 1.12 : 1.12)),
      }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Projected from the same camera and the same field of view as the frame
  // being drawn, so a caption and its arrowhead move together.
  const captions = useMemo<PlateViewCaption[]>(() => {
    if (!layers.loads || canvasSize.width === 0 || canvasSize.height === 0) return [];
    const viewProjection = viewProjectionOf(camera, canvasSize.width / canvasSize.height);
    const placed: PlateViewCaption[] = [];
    loadArrows.labels.forEach((label, index) => {
      const at = projectToScreen(viewProjection, label.at, canvasSize.width, canvasSize.height);
      if (!at) return;
      placed.push({
        key: `${label.unit}-${label.name}-${index}`,
        text: t(`plate3d.load.${label.unit}`, {
          name: label.name,
          value: formatSignificant(label.value, 3, locale),
        }),
        x: at.x,
        y: at.y,
      });
    });
    return placed;
  }, [loadArrows, camera, canvasSize, layers.loads, t, locale]);

  const viewProjection = useMemo(
    () =>
      canvasSize.width > 0 && canvasSize.height > 0
        ? viewProjectionOf(camera, canvasSize.width / canvasSize.height)
        : null,
    [camera, canvasSize],
  );

  /** A point on the plate, in the plate's own coordinates, to world. */
  const worldAt = useCallback(
    (x: number, y: number): [number, number, number] => {
      const u = length > 0 ? x / length : 0.5;
      const v = width > 0 ? y / width : 0.5;
      return [
        (u * 2 - 1) * body.frame.halfLength,
        (v * 2 - 1) * body.frame.halfWidth,
        sampler(u, v) + body.frame.halfThickness,
      ];
    },
    [body.frame, length, width, sampler],
  );

  const project = useCallback(
    (at: [number, number, number]) =>
      viewProjection
        ? projectToScreen(viewProjection, at, canvasSize.width, canvasSize.height)
        : null,
    [viewProjection, canvasSize],
  );

  const extremes = useMemo<PlateViewMarker[]>(() => {
    if (!markers) return [];
    const placed: PlateViewMarker[] = [];
    for (const marker of markers) {
      const at = project(worldAt(marker.at[0], marker.at[1]));
      if (!at) continue;
      placed.push({ key: marker.kind, kind: marker.kind, text: marker.text, x: at.x, y: at.y });
    }
    return placed;
  }, [markers, project, worldAt]);

  const readout = useMemo<PlateViewCaption | null>(() => {
    if (!probe || !readoutText) return null;
    const at = project(worldAt(probe.x, probe.y));
    if (!at) return null;
    const value = colours ? sampleGrid(colours, probe.u, probe.v) : sampleGrid(surface, probe.u, probe.v);
    return {
      key: "probe",
      text: readoutText({ x: probe.x, y: probe.y, value }),
      x: at.x,
      // Lifted clear of the pointer, which would otherwise sit on the text.
      y: at.y - 18,
    };
  }, [probe, readoutText, project, worldAt, colours, surface]);

  const axes = useMemo<PlateViewAxis[]>(
    () =>
      (
        [
          ["x", [1, 0, 0]],
          ["y", [0, 1, 0]],
          ["z", [0, 0, 1]],
        ] as [string, [number, number, number]][]
      ).map(([label, axis]) => {
        const [dx, dy] = screenDirectionOf(camera, axis);
        return { label, dx, dy };
      }),
    [camera],
  );

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        cameraDistance: camera.distance,
      };
      drag.current = null;
    } else {
      drag.current = { x: event.clientX, y: event.clientY, camera };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) {
      // Not a drag: read the value under the pointer instead (FR-11).
      updateProbe(event);
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.distance > 0) {
        const factor = pinch.current.distance / distance;
        setCamera((current) => ({
          ...current,
          distance: clampDistance(pinch.current!.cameraDistance * factor),
        }));
      }
      return;
    }

    const start = drag.current;
    if (!start) return;
    setCamera(orbitAfterDrag(start.camera, event.clientX - start.x, event.clientY - start.y));
  };

  const updateProbe = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!readoutText) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = pickPlate(
      camera,
      {
        halfLength: body.frame.halfLength,
        halfWidth: body.frame.halfWidth,
        height: sampler,
      },
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
    setProbe(hit ? { u: hit.u, v: hit.v, x: hit.u * length, y: hit.v * width } : null);
  };

  const endPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  if (!supported) {
    return (
      <>
        <BucklingPlate3D
          surface={normalised(surface)}
          length={length}
          width={width}
          zScale={deflectionFraction}
        />
        <p className="hint">{t("plate3d.fallback")}</p>
      </>
    );
  }

  return (
    <div className="plate3d">
      <canvas
        ref={canvasRef}
        className="plate3d-canvas"
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => setProbe(null)}
      />
      <PlateViewOverlay
        captions={captions}
        markers={extremes}
        readout={readout}
        axes={axes}
        onStandardView={(view) => setCamera(STANDARD_VIEWS[view])}
        layers={layers}
        onToggle={onToggleLayer}
        available={{
          supports: Boolean(bcX && bcY),
          loads: loadArrows.arrows.length > 0,
        }}
      />
      {/* The picture is not to scale in two ways at once, so it says so in
          both. Without this the reader has a solid-looking body whose
          proportions are invented. */}
      <p className="plate3d-scales">
        {t("plate3d.scales", {
          deflection: formatSignificant(scales.deflection, 3, locale),
          thickness: formatSignificant(scales.thickness, 3, locale),
        })}
      </p>
    </div>
  );
});

/** Nearest sample of a grid at (u, v), or null where there is no answer. */
function sampleGrid(grid: (number | null)[][], u: number, v: number): number | null {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  if (rows === 0 || cols === 0) return null;
  const row = Math.round(Math.min(1, Math.max(0, v)) * (rows - 1));
  const col = Math.round(Math.min(1, Math.max(0, u)) * (cols - 1));
  const value = grid[row][col];
  return value !== null && Number.isFinite(value) ? value : null;
}

/** `rgb(r, g, b)` or `rgba(...)` to three 0..1 channels. */
function parseCssColor(value: string): [number, number, number] {
  const parts = value.match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return [0.5, 0.5, 0.5];
  return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
}

/** Peak-normalised copy, which is what the 2D fallback expects. */
function normalised(surface: number[][]): number[][] {
  const peak = peakOf(surface);
  if (peak === 0) return surface;
  return surface.map((row) => row.map((value) => value / peak));
}
