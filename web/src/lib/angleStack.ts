
// Ply angles are conventionally given in (-90 deg, 90 deg] - a fiber line at
// theta is physically identical to one at theta+180 deg (no "front/back" to
// a fiber direction, and Qbar depends only on cos^2/sin^2/sin*cos of theta,
// all periodic in 180 deg), so any angle a user enters or a stack operation
// produces is reduced to its unique representative in [-90, 90] here. Using
// "> 90"/"< -90" (not >=/<=) keeps already-canonical -90 and 90 unchanged,
// so this is idempotent for values already in range.
export function normalizeLayerAngle(angle: number): number {
  let a = angle % 180;
  if (a < -90) a += 180;
  if (a > 90) a -= 180;
  return a;
}

/** A stacking sequence as written down: the stored half and how it is
 *  completed - the same three facts a laminate keeps. */
export interface Layup {
  angles: number[];
  symmetric: boolean;
  /** The last angle is the shared middle ply of a symmetric stack. */
  withMiddleLayer: boolean;
}

export type LayupError =
  /** Nothing to read. */
  | "empty"
  /** Something where an angle belongs that is not one. */
  | "angle"
  /** A bracket or parenthesis opened and not closed. */
  | "unclosed"
  /** Text left over after a complete stack. */
  | "unexpected"
  /** An overbar anywhere but on the last angle of a symmetric stack. */
  | "middle"
  /** A repeat count of zero, or one too large to mean anything. */
  | "count";

export type LayupParse =
  | { ok: true; layup: Layup }
  /** `at` is the character offset the reader stopped at. */
  | { ok: false; error: LayupError; at: number };

// The characters of the notation. Subscript digits are what the formatter
// writes and what people paste from a report; the ASCII forms are what they
// type.
const SUBSCRIPTS = ["\u2080", "\u2081", "\u2082", "\u2083", "\u2084", "\u2085", "\u2086", "\u2087", "\u2088", "\u2089"];
/** U+0304 COMBINING MACRON: the bar over a middle ply's angle. */
const MACRON = "\u0304";
/** More plies than any laminate has; a count past it is a typing error. */
const MAX_COUNT = 1000;

class LayupSyntaxError extends Error {
  readonly reason: LayupError;
  readonly at: number;
  constructor(reason: LayupError, at: number) {
    super(reason);
    this.reason = reason;
    this.at = at;
  }
}

/**
 * Reads the stacking notation, e.g. `[0/±45/90]2s`.
 *
 * ```
 * stack  := "[" seq "]" repeat? sym?  |  seq
 * seq    := item ("/" item)*
 * item   := angle count? bar?  |  "(" seq ")" count?
 * angle  := ("±" | "+-" | "∓" | "-+")? number     ±45 → 45/-45, ∓45 → -45/45
 * count  := "_" digits | subscript digits          0₂ → 0/0, ±45₂ → (±45)₂
 * repeat := digits | count
 * sym    := "s" | "S" | "ₛ" | "se"                 symmetric, even
 *         | "s̄" | "sT"                             symmetric, last ply is the middle
 * bar    := U+0304 over the last angle             that angle is the middle ply
 * ```
 *
 * Either decimal separator is read, as everywhere else in the app. Angles are
 * returned as written; reducing them to (-90, 90] is the caller's business.
 */
export function parseLayup(text: string): LayupParse {
  let pos = 0;
  const fail = (reason: LayupError, at = pos): never => {
    throw new LayupSyntaxError(reason, at);
  };
  const skipSpace = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };
  const peek = () => {
    skipSpace();
    return text[pos] ?? "";
  };
  // Where the overbar was found, to be checked against the finished stack:
  // only its very last ply can be the middle.
  const bars: { plyIndex: number; at: number }[] = [];

  const readDigits = (subscript: boolean): number | null => {
    const start = pos;
    let value = "";
    while (pos < text.length) {
      const ch = text[pos];
      const digit = subscript ? SUBSCRIPTS.indexOf(ch) : /[0-9]/.test(ch) ? Number(ch) : -1;
      if (digit < 0) break;
      value += digit;
      pos++;
    }
    if (value === "") return null;
    const n = Number(value);
    if (n < 1 || n > MAX_COUNT) fail("count", start);
    return n;
  };

  /** `_2` or `₂`, or nothing. */
  const readCount = (): number | null => {
    skipSpace();
    if (text[pos] === "_") {
      pos++;
      return readDigits(false) ?? fail("count");
    }
    return readDigits(true);
  };

  const readNumber = (): number => {
    skipSpace();
    const match = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)/.exec(text.slice(pos));
    if (!match) return fail("angle");
    pos += match[0].length;
    return Number(match[0].replace(",", "."));
  };

  const readItem = (out: number[]) => {
    if (peek() === "(") {
      const open = pos;
      pos++;
      const inner: number[] = [];
      readSeq(inner);
      if (peek() !== ")") fail("unclosed", open);
      pos++;
      // After a parenthesis plain digits are unambiguous, and how "(0/90)3"
      // is usually typed.
      skipSpace();
      const count = (/[0-9]/.test(text[pos] ?? "") ? readDigits(false) : readCount()) ?? 1;
      for (let i = 0; i < count; i++) out.push(...inner);
      return;
    }
    skipSpace();
    let pair: 1 | -1 | 0 = 0;
    if (text.startsWith("±", pos) || text.startsWith("+-", pos)) {
      pair = 1;
      pos += text[pos] === "±" ? 1 : 2;
    } else if (text.startsWith("∓", pos) || text.startsWith("-+", pos)) {
      pair = -1;
      pos += text[pos] === "∓" ? 1 : 2;
    }
    const angle = readNumber();
    const count = readCount() ?? 1;
    const plies = pair === 0 ? [angle] : [pair * angle, -pair * angle];
    if (text[pos] === MACRON) {
      // A middle ply is one ply: a pair or a count has no single middle.
      if (pair !== 0 || count !== 1) fail("middle");
      bars.push({ plyIndex: out.length, at: pos });
      pos++;
    }
    for (let i = 0; i < count; i++) out.push(...plies);
  };

  function readSeq(out: number[]) {
    readItem(out);
    while (peek() === "/") {
      pos++;
      readItem(out);
    }
  }

  try {
    if (text.trim() === "") return { ok: false, error: "empty", at: 0 };
    const angles: number[] = [];
    let symmetric = false;
    let middle = false;
    if (peek() === "[") {
      const open = pos;
      pos++;
      readSeq(angles);
      if (peek() !== "]") fail("unclosed", open);
      pos++;
      skipSpace();
      const repeat = /[0-9]/.test(text[pos] ?? "") ? readDigits(false) : readCount();
      if (repeat !== null) {
        // Repeating a block that holds the middle ply would put it inside.
        if (bars.length > 0) fail("middle", bars[0].at);
        const once = [...angles];
        for (let i = 1; i < repeat; i++) angles.push(...once);
      }
      skipSpace();
      if (/^[sS\u209B]/.test(text[pos] ?? "")) {
        symmetric = true;
        pos++;
        if (text[pos] === MACRON || text[pos] === "T") {
          middle = true;
          pos++;
        } else if (text[pos] === "e") {
          pos++;
        }
      }
    } else {
      readSeq(angles);
    }
    if (peek() !== "") fail("unexpected");
    if (bars.length > 0) {
      const bar = bars[0];
      if (bars.length > 1 || !symmetric || bar.plyIndex !== angles.length - 1) fail("middle", bar.at);
      middle = true;
    }
    return { ok: true, layup: { angles, symmetric, withMiddleLayer: middle } };
  } catch (e) {
    if (e instanceof LayupSyntaxError) return { ok: false, error: e.reason, at: e.at };
    throw e;
  }
}

/** Every ply of the laminate, the mirrored half included - what a stack
 *  looks like once it is laid up. */
export function expandLayup(layup: Layup): number[] {
  const { angles, symmetric, withMiddleLayer } = layup;
  if (!symmetric) return [...angles];
  const mirrored = [...angles].reverse().slice(withMiddleLayer ? 1 : 0);
  return [...angles, ...mirrored];
}

// Web counterpart of the Java original's LaminateStringParser convenience:
// the add-layer angle field accepts a whole stacking notation like
// "0/45/-45/90" or "[0/±45/90]s" and creates one layer per angle - the
// mirrored half written out, since the field adds plies to whatever stack is
// already there. A single plain number is the 1-element case.
export function parseAngleStack(text: string): number[] | null {
  const parsed = parseLayup(text);
  return parsed.ok ? expandLayup(parsed.layup) : null;
}

function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)])
    .join("");
}

interface Token {
  angle: number;
  /** A ply followed by its negative. */
  pair: boolean;
  count: number;
}

/** One run of plies as notation: `0`, `0₂`, `±45`, `(±45)₂`. */
function tokenText(token: Token): string {
  if (!token.pair) return `${formatAngle(token.angle)}${token.count > 1 ? subscript(token.count) : ""}`;
  const body = `${token.angle > 0 ? "±" : "∓"}${formatAngle(Math.abs(token.angle))}`;
  return token.count > 1 ? `(${body})${subscript(token.count)}` : body;
}

/** A sequence of plies, as short as the notation allows without becoming
 *  ambiguous: runs of equal angles get a count, and a single ply followed by
 *  its negative becomes a ± pair. */
function compress(angles: number[]): string[] {
  // Runs first, so 45/45/-45/-45 stays 45₂/-45₂ rather than turning into
  // 45/±45/-45.
  const runs: Token[] = [];
  for (const angle of angles) {
    const last = runs[runs.length - 1];
    if (last && last.angle === angle) last.count += 1;
    else runs.push({ angle, pair: false, count: 1 });
  }
  const tokens: Token[] = [];
  for (let i = 0; i < runs.length; i++) {
    const a = runs[i];
    const b = runs[i + 1];
    // 0 and 90 are their own negatives (90 ≡ -90), so ±0 and ±90 mean nothing.
    const pairable = a.angle !== 0 && Math.abs(a.angle) !== 90;
    if (pairable && b && a.count === 1 && b.count === 1 && b.angle === -a.angle) {
      const last = tokens[tokens.length - 1];
      if (last && last.pair && last.angle === a.angle) last.count += 1;
      else tokens.push({ angle: a.angle, pair: true, count: 1 });
      i++;
    } else {
      tokens.push({ ...a });
    }
  }
  return tokens.map(tokenText);
}

/** The shortest block the sequence is several copies of, and how many. */
function period(angles: number[]): { length: number; times: number } {
  const n = angles.length;
  for (let p = 2; p <= n / 2; p++) {
    if (n % p !== 0) continue;
    if (angles.every((a, i) => a === angles[i % p])) return { length: p, times: n / p };
  }
  return { length: n, times: 1 };
}

/**
 * The stack in the notation people write on a drawing: `[0₂/±45/90]s`.
 *
 * The inverse of `parseLayup` - what it writes reads back as the same layup.
 * Runs of equal angles get a subscripted count, ± pairs are written as one, a
 * stack that is one block several times over gets a repeat count after the
 * bracket, a symmetric laminate the trailing `s` instead of its mirrored
 * half, and a middle ply the bar over its angle.
 */
export function formatLayup(layup: Layup): string {
  const { angles, symmetric } = layup;
  if (angles.length === 0) return "[ ]";
  const middle = symmetric && layup.withMiddleLayer;
  const head = middle ? angles.slice(0, -1) : angles;

  const suffix = symmetric ? "s" : "";
  if (middle) {
    // The bar goes over the ANGLE it refers to, not after the bracket. A
    // repeat would apply to the middle ply too, so there is none.
    const parts = [...compress(head), `${formatAngle(angles[angles.length - 1])}${MACRON}`];
    return `[${parts.join("/")}]${suffix}`;
  }
  const plain = `[${compress(head).join("/")}]${suffix}`;
  const { length, times } = period(head);
  if (times === 1) return plain;
  const repeated = `[${compress(head.slice(0, length)).join("/")}]${times}${suffix}`;
  // A repeat only where it is shorter: [0₄] says it better than [0₂]2.
  return repeated.length < plain.length ? repeated : plain;
}

/** `formatLayup` for the three fields a laminate keeps them in. Angles are
 *  the STORED ones, so this is the same half of the stack the layer table
 *  shows. */
export function shortStackNotation(
  angles: number[],
  symmetric: boolean,
  withMiddleLayer: boolean,
): string {
  return formatLayup({ angles, symmetric, withMiddleLayer });
}

// Angles are data, not measurements: -45 stays "-45", 22.5 stays "22.5". No
// locale formatting, because this string is meant to be recognised and
// re-typed into the angle field, which parses both separators anyway. Twelve
// significant digits drop the binary noise of a rotated angle without
// dropping anything anyone typed.
function formatAngle(angle: number): string {
  const clean = Number(angle.toPrecision(12));
  return String(Object.is(clean, -0) ? 0 : clean);
}

/**
 * Expanded ply count and total thickness of a stored stack, following
 * `Laminate::number_of_layers` / `Laminate::thickness` in the core: a
 * symmetric laminate is mirrored, and a shared middle layer - always the LAST
 * stored one - is counted once.
 */
export function expandedStack(
  thicknesses: number[],
  symmetric: boolean,
  withMiddleLayer: boolean,
): { plies: number; thickness: number } {
  let plies = thicknesses.length;
  let thickness = thicknesses.reduce((sum, t) => sum + t, 0);
  if (symmetric) {
    plies *= 2;
    thickness *= 2;
    if (withMiddleLayer && thicknesses.length > 0) {
      plies -= 1;
      thickness -= thicknesses[thicknesses.length - 1];
    }
  }
  return { plies, thickness };
}
