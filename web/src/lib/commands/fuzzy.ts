// Fuzzy matching for the command palette.
//
// Written here rather than taken from a library: the palette searches a few
// hundred short labels at most, and what matters is a ranking that feels
// right for them - "beul" finds "Plattenbeulen", "lk" finds "Lagen kopieren"
// - which is a page of code, not a dependency.

/** Lower case without diacritics, so "u" finds "ü" and "Ä" finds "a". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const WORD_START = /[\s\-_/().,:·]/;

/**
 * How well `query` matches `text`: null when it does not - every query
 * character has to appear in the text, in order - and otherwise a score,
 * higher being better.
 *
 * What scores: a match at the start of the text or of a word, characters
 * that follow each other in the text as they do in the query, and a short
 * text (the query says more of it). A plain substring beats any scattered
 * match, and a prefix beats a substring.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query.trim());
  if (q === "") return 0;
  const s = fold(text);

  const at = s.indexOf(q);
  if (at >= 0) {
    const wordStart = at === 0 || WORD_START.test(s[at - 1]);
    return 1000 + (at === 0 ? 300 : wordStart ? 200 : 0) - s.length;
  }

  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    // Prefer the next word start that has the character over the first
    // occurrence: "lk" should take the k of "kopieren", not of "Lagekarte".
    let found = -1;
    for (let i = from; i < s.length; i++) {
      if (s[i] !== ch) continue;
      if (i === 0 || WORD_START.test(s[i - 1])) {
        found = i;
        break;
      }
      if (found < 0) found = i;
    }
    if (found < 0) return null;
    if (found === previous + 1) score += 15;
    if (found === 0 || WORD_START.test(s[found - 1])) score += 25;
    score -= Math.min(found - from, 10);
    previous = found;
    from = found + 1;
  }
  return score - s.length / 10;
}

/** The entries that match, best first; ties keep their original order. */
export function rankEntries<T>(query: string, entries: T[], text: (entry: T) => string): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: fuzzyScore(query, text(entry)) }))
    .filter((e): e is { entry: T; index: number; score: number } => e.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((e) => e.entry);
}
