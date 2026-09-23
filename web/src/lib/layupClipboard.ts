// Plies in and out of the clipboard.
//
// Copying writes the selected plies in two formats at once. Plain text is a
// table with a header row, which Excel, a mail and a text editor all take;
// HTML is the same table - Excel prefers it - carrying the plies once more,
// losslessly, in a `data-elamx-layup` attribute: material definitions and
// ids included, so a paste into another project brings the materials along.
//
// Pasting tries the formats from the richest down: that attribute, then a
// table (from Excel, or typed with tabs), then the stacking notation of
// `parseLayup`. What comes out is a description of plies, not layers yet -
// which material a name means and what a missing column defaults to is
// decided with the user, in the paste dialog (`resolvePaste`).
//
// No DOM here: the HTML is read with a regular expression, so this runs, and
// is tested, anywhere.

import { CATEGORY_DEFINITIONS, type QuantityCategory } from "./units";
import { parseLocaleNumber } from "./numberFormat";
import { expandLayup, normalizeLayerAngle, parseLayup } from "./angleStack";
import { toDelimited, toHtmlTable, type TableModel } from "./export/table";
import type { FormatConfig } from "../store/formatAtoms";
import { CRITERIA, type CriterionId, type MaterialDto } from "./types";
import { DEFAULT_CRITERION_ID, type LayerRow } from "./constants";
import { translate, type Locale } from "../i18n";

/** The version of the `data-elamx-layup` payload. */
const PAYLOAD_VERSION = 1;

interface PayloadPly {
  name: string;
  angle: number;
  thickness: number;
  materialId: string;
  criterionId: CriterionId;
}

interface LayupPayload {
  v: number;
  plies: PayloadPly[];
  /** The definitions of the materials the plies use. */
  materials: MaterialDto[];
}

/** One ply as the clipboard described it; what it did not say is absent. */
export interface ClipboardPly {
  angle: number;
  thickness?: number;
  /** The material's name, as the source named it. */
  material?: string;
  /** The material's id in the project it was copied from. */
  materialId?: string;
  criterion?: CriterionId;
  name?: string;
}

export type PasteWarning =
  /** Rows of a table that had no angle to read. */
  | { kind: "skippedRows"; count: number }
  /** A criterion name nothing here answers to; the default is used. */
  | { kind: "unknownCriterion"; value: string };

export interface ParsedLayup {
  source: "elamx" | "table" | "notation";
  plies: ClipboardPly[];
  /** From the notation: the plies are the defined half of a symmetric stack. */
  symmetric: boolean;
  withMiddleLayer: boolean;
  /** Material definitions that came along (only from eLamX itself). */
  materials: MaterialDto[];
  warnings: PasteWarning[];
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

export interface CopyOptions {
  locale: Locale;
  /** The user's unit settings, so the table shows the units the screen does;
   *  the header names them, and a paste converts back. */
  formats?: (category: QuantityCategory) => FormatConfig;
}

function criterionLabel(id: CriterionId, locale: Locale): string {
  const entry = CRITERIA.find((c) => c.id === id);
  return entry ? translate(locale, entry.labelKey) : id;
}

/** The plies as a table, in the order given. */
export function layupTable(layers: LayerRow[], materials: MaterialDto[], locale: Locale): TableModel {
  const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return {
    title: tr("layers.title"),
    columns: [
      { key: "angle", label: tr("layers.column.angle"), category: "angle" },
      { key: "thickness", label: tr("layers.column.thickness"), category: "thickness" },
      { key: "material", label: tr("layers.column.material") },
      { key: "criterion", label: tr("layers.column.criterion") },
      { key: "name", label: tr("common.name") },
    ],
    rows: layers.map((l) => [
      l.angle,
      l.thickness,
      materials.find((m) => m.id === l.materialId)?.name ?? "",
      criterionLabel(l.criterionId, locale),
      l.name,
    ]),
  };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): string {
  const binary = atob(text);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** What a copy puts on the clipboard: `text/plain` and `text/html`. */
export function layupClipboardData(
  layers: LayerRow[],
  materials: MaterialDto[],
  { locale, formats }: CopyOptions,
): { text: string; html: string } {
  const table = layupTable(layers, materials, locale);
  // A decimal comma where the spreadsheet's language has one, but always a
  // tab between fields: that is what Excel pastes as columns in any
  // language.
  const decimal = locale === "de" ? "," : ".";
  const text = toDelimited(table, { locale, sep: "\t", decimal, precision: "full", formats });
  const used = new Set(layers.map((l) => l.materialId));
  const payload: LayupPayload = {
    v: PAYLOAD_VERSION,
    plies: layers.map((l) => ({
      name: l.name,
      angle: l.angle,
      thickness: l.thickness,
      materialId: l.materialId,
      criterionId: l.criterionId,
    })),
    materials: materials.filter((m) => used.has(m.id)),
  };
  const html = toHtmlTable(table, { locale, decimal, precision: "full", formats }).replace(
    "<table>",
    `<table data-elamx-layup="${toBase64(JSON.stringify(payload))}">`,
  );
  return { text, html };
}

// ---------------------------------------------------------------------------
// Pasting
// ---------------------------------------------------------------------------

function fromPayload(html: string): ParsedLayup | null {
  const match = /data-elamx-layup="([A-Za-z0-9+/=]+)"/.exec(html);
  if (!match) return null;
  try {
    const payload = JSON.parse(fromBase64(match[1])) as LayupPayload;
    if (payload.v !== PAYLOAD_VERSION || !Array.isArray(payload.plies)) return null;
    const materials = Array.isArray(payload.materials) ? payload.materials : [];
    return {
      source: "elamx",
      plies: payload.plies.map((p) => ({
        angle: p.angle,
        thickness: p.thickness,
        materialId: p.materialId,
        material: materials.find((m) => m.id === p.materialId)?.name,
        criterion: p.criterionId,
        name: p.name,
      })),
      symmetric: false,
      withMiddleLayer: false,
      materials,
      warnings: [],
    };
  } catch {
    // A mangled attribute is no payload; the table next to it still is one.
    return null;
  }
}

type ColumnRole = "angle" | "thickness" | "material" | "criterion" | "name" | "ignore";

// Header words, in both languages and the usual abbreviations, lower case.
const HEADER_WORDS: [ColumnRole, RegExp][] = [
  ["angle", /^(winkel|angle|orientation|orientierung|ausrichtung|faserwinkel|theta|θ|°)$/],
  ["thickness", /^(dicke|thickness|stärke|staerke|t|t_ply|lagendicke|ply thickness)$/],
  ["material", /^(material|werkstoff|mat\.?)$/],
  ["criterion", /^(kriterium|criterion|versagenskriterium|failure criterion|bruchkriterium)$/],
  ["name", /^(name|bezeichnung|label)$/],
  ["ignore", /^(nr\.?|no\.?|#|lage|ply|layer|pos\.?|position)$/],
];

/** A header cell as its role and the unit its values are in, if it says. */
function readHeader(cell: string): { role: ColumnRole | null; unit: string | null } {
  const unitMatch = /\[([^\]]*)\]\s*$/.exec(cell) ?? /\(([^)]*)\)\s*$/.exec(cell);
  const word = cell
    .replace(/\[[^\]]*\]\s*$/, "")
    .replace(/\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  const role = HEADER_WORDS.find(([, re]) => re.test(word))?.[0] ?? null;
  return { role, unit: unitMatch ? unitMatch[1].trim() : null };
}

/** A number in the column's unit, converted into the core's. */
function toCanonical(category: QuantityCategory, unit: string | null, value: number): number {
  if (!unit) return value;
  const option = CATEGORY_DEFINITIONS[category].units?.find((u) => u.label === unit || u.id === unit);
  return option ? option.toCanonical(value) : value;
}

/** A criterion by its id or its name in either language. */
export function matchCriterion(text: string): CriterionId | null {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return null;
  for (const c of CRITERIA) {
    if (
      c.id === wanted ||
      translate("de", c.labelKey).toLowerCase() === wanted ||
      translate("en", c.labelKey).toLowerCase() === wanted
    ) {
      return c.id;
    }
  }
  return null;
}

function splitRows(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("\t").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")));
}

function fromTable(text: string): ParsedLayup | null {
  const rows = splitRows(text);
  if (rows.length === 0) return null;

  // A header row is one whose cells name columns rather than hold an angle.
  const header = rows[0].map(readHeader);
  const hasHeader =
    parseLocaleNumber(rows[0][0] ?? "") === null && header.some((h) => h.role !== null && h.role !== "ignore");
  // Without a header the order is the one this app writes: angle, thickness,
  // material, criterion, name.
  const roles: { role: ColumnRole | null; unit: string | null }[] = hasHeader
    ? header
    : rows[0].map((_, i) => ({
        role: (["angle", "thickness", "material", "criterion", "name"] as const)[i] ?? null,
        unit: null,
      }));
  const column = (role: ColumnRole) => roles.findIndex((r) => r.role === role);
  const angleAt = column("angle");
  if (angleAt < 0) return null;
  const thicknessAt = column("thickness");
  const materialAt = column("material");
  const criterionAt = column("criterion");
  const nameAt = column("name");

  const plies: ClipboardPly[] = [];
  const warnings: PasteWarning[] = [];
  let skipped = 0;
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const angle = parseLocaleNumber(row[angleAt] ?? "");
    if (angle === null) {
      skipped++;
      continue;
    }
    const ply: ClipboardPly = { angle: toCanonical("angle", roles[angleAt].unit, angle) };
    if (thicknessAt >= 0) {
      const thickness = parseLocaleNumber(row[thicknessAt] ?? "");
      if (thickness !== null && thickness > 0) {
        ply.thickness = toCanonical("thickness", roles[thicknessAt].unit, thickness);
      }
    }
    if (materialAt >= 0 && row[materialAt]) ply.material = row[materialAt];
    if (criterionAt >= 0 && row[criterionAt]) {
      const criterion = matchCriterion(row[criterionAt]);
      if (criterion) ply.criterion = criterion;
      else if (!warnings.some((w) => w.kind === "unknownCriterion" && w.value === row[criterionAt])) {
        warnings.push({ kind: "unknownCriterion", value: row[criterionAt] });
      }
    }
    if (nameAt >= 0 && row[nameAt]) ply.name = row[nameAt];
    plies.push(ply);
  }
  if (plies.length === 0) return null;
  if (skipped > 0) warnings.unshift({ kind: "skippedRows", count: skipped });
  return { source: "table", plies, symmetric: false, withMiddleLayer: false, materials: [], warnings };
}

function fromNotation(text: string): ParsedLayup | null {
  const parsed = parseLayup(text.trim());
  if (!parsed.ok) return null;
  const { angles, symmetric, withMiddleLayer } = parsed.layup;
  return {
    source: "notation",
    plies: angles.map((angle) => ({ angle })),
    symmetric,
    withMiddleLayer,
    materials: [],
    warnings: [],
  };
}

/**
 * Plies from whatever the clipboard held, or null if it held none. The
 * eLamX payload wins over the table it sits in, and a table over the
 * notation: a single line without tabs is notation ("0/45/-45/90"), since
 * a table of one ply would say the same.
 */
export function parseClipboard({ html, text }: { html?: string; text?: string }): ParsedLayup | null {
  if (html) {
    const payload = fromPayload(html);
    if (payload) return payload;
  }
  if (!text || text.trim() === "") return null;
  const oneLine = !/[\r\n]/.test(text.trim());
  if (oneLine && !text.includes("\t")) return fromNotation(text) ?? fromTable(text);
  return fromTable(text) ?? fromNotation(text);
}

// ---------------------------------------------------------------------------
// From plies to layers
// ---------------------------------------------------------------------------

/** A material name the project does not have, as the clipboard named it. */
export interface UnknownMaterial {
  /** Lower-cased and trimmed, which is how names are compared. */
  key: string;
  name: string;
  /** Its definition, when the clipboard carried one. */
  definition?: MaterialDto;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** The project material a ply names, if one answers: the same id with the
 *  same name (a copy within the project), else the same name. */
function knownMaterial(ply: ClipboardPly, materials: MaterialDto[]): MaterialDto | null {
  if (ply.materialId) {
    const byId = materials.find((m) => m.id === ply.materialId);
    if (byId && (!ply.material || nameKey(byId.name) === nameKey(ply.material))) return byId;
  }
  if (ply.material) return materials.find((m) => nameKey(m.name) === nameKey(ply.material!)) ?? null;
  return null;
}

/** The material names that need the user to say what they mean. */
export function unknownMaterials(parsed: ParsedLayup, materials: MaterialDto[]): UnknownMaterial[] {
  const unknown: UnknownMaterial[] = [];
  for (const ply of parsed.plies) {
    if (!ply.material || knownMaterial(ply, materials)) continue;
    const key = nameKey(ply.material);
    if (unknown.some((u) => u.key === key)) continue;
    const definition = parsed.materials.find((m) => m.id === ply.materialId);
    unknown.push({ key, name: ply.material, definition });
  }
  return unknown;
}

/** What fills a column the clipboard did not have (O7): the material and
 *  thickness of the ply the paste goes next to, and its criterion. */
export interface PasteDefaults {
  materialId: string;
  thickness: number;
  criterionId: CriterionId;
}

/** The defaults from the ply a paste lands next to: the first selected one,
 *  or the last one when nothing is selected. */
export function pasteDefaults(
  layers: LayerRow[],
  selected: ReadonlySet<string>,
  materials: MaterialDto[],
): PasteDefaults {
  const reference = layers.find((l) => selected.has(l.id)) ?? layers.at(-1);
  return {
    materialId: reference?.materialId ?? materials[0]?.id ?? "",
    thickness: reference?.thickness ?? 0.2,
    criterionId: reference?.criterionId ?? DEFAULT_CRITERION_ID,
  };
}

/** For each unknown material: an existing material's id, or `create` to add
 *  the definition the clipboard carried. */
export type MaterialMapping = Record<string, string>;
export const CREATE_MATERIAL = "__create__";

export interface ResolveOptions {
  materials: MaterialDto[];
  defaults: PasteDefaults;
  mapping: MaterialMapping;
  /** Keep the plies as the defined half of a symmetric stack (the caller
   *  then sets the laminate's flags) rather than writing the mirror out. */
  keepSymmetric: boolean;
  newId: () => string;
  /** The name of a ply the clipboard did not name. */
  plyName: (index: number) => string;
}

/** The layers a paste inserts, and the materials it adds. */
export function resolvePaste(
  parsed: ParsedLayup,
  { materials, defaults, mapping, keepSymmetric, newId, plyName }: ResolveOptions,
): { layers: LayerRow[]; newMaterials: MaterialDto[] } {
  const newMaterials: MaterialDto[] = [];
  const created = new Map<string, string>();
  const materialFor = (ply: ClipboardPly): string => {
    const known = knownMaterial(ply, materials);
    if (known) return known.id;
    if (!ply.material) return defaults.materialId;
    const key = nameKey(ply.material);
    const choice = mapping[key];
    if (choice === CREATE_MATERIAL) {
      const existing = created.get(key);
      if (existing) return existing;
      const definition = parsed.materials.find((m) => m.id === ply.materialId);
      if (!definition) return defaults.materialId;
      const id = newId();
      newMaterials.push({ ...definition, id });
      created.set(key, id);
      return id;
    }
    return choice && materials.some((m) => m.id === choice) ? choice : defaults.materialId;
  };

  const plies =
    parsed.symmetric && !keepSymmetric
      ? expandLayup({
          angles: parsed.plies.map((_, i) => i),
          symmetric: true,
          withMiddleLayer: parsed.withMiddleLayer,
        }).map((i) => parsed.plies[i])
      : parsed.plies;

  const layers = plies.map((ply, i) => ({
    id: newId(),
    name: ply.name ?? plyName(i),
    angle: normalizeLayerAngle(ply.angle),
    thickness: ply.thickness ?? defaults.thickness,
    materialId: materialFor(ply),
    criterionId: ply.criterion ?? defaults.criterionId,
  }));
  return { layers, newMaterials };
}
