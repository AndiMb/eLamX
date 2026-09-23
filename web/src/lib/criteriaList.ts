// A ply's failure criteria as one ordered list (F2.1).
//
// The row keeps them apart - `criterionId` is the primary criterion, the one
// eLamX 3.x stores and reads, and `extraCriteria` the rest - because that is
// how the file keeps them. Everything that edits them works on the list, and
// these functions are the only place the two views meet.

import type { LayerRow } from "./constants";
import type { CriterionId } from "./types";

/** The ply's criteria, primary first, each once. */
export function criteriaOf(row: Pick<LayerRow, "criterionId" | "extraCriteria">): CriterionId[] {
  return dedupe([row.criterionId, ...(row.extraCriteria ?? [])]);
}

/** `row` with its criteria replaced by `list` (primary first). An empty list
 *  leaves the row as it is: a ply always has a criterion. `extraCriteria` is
 *  absent rather than empty when there are none, so a row with one criterion
 *  looks exactly as it did before extra criteria existed. */
export function withCriteria<T extends Pick<LayerRow, "criterionId" | "extraCriteria">>(
  row: T,
  list: readonly CriterionId[],
): T {
  const unique = dedupe(list);
  if (unique.length === 0) return row;
  const { extraCriteria: _old, ...rest } = row;
  const [primary, ...extra] = unique;
  return (extra.length > 0 ? { ...rest, criterionId: primary, extraCriteria: extra } : { ...rest, criterionId: primary }) as T;
}

/** A new primary criterion from the table's dropdown: it takes the first
 *  place, and leaves the extras if it was one of them. */
export function withPrimary<T extends Pick<LayerRow, "criterionId" | "extraCriteria">>(
  row: T,
  primary: CriterionId,
): T {
  return withCriteria(row, [primary, ...(row.extraCriteria ?? []).filter((c) => c !== primary)]);
}

/** Moves the entry at `index` one place up (-1) or down (+1); out of range
 *  leaves the list as it is. */
export function moveCriterion(list: readonly CriterionId[], index: number, direction: -1 | 1): CriterionId[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Appends a criterion that is not in the list yet. */
export function addCriterion(list: readonly CriterionId[], id: CriterionId): CriterionId[] {
  return list.includes(id) ? [...list] : [...list, id];
}

/** Removes a criterion - unless it is the only one. */
export function removeCriterion(list: readonly CriterionId[], index: number): CriterionId[] {
  if (list.length <= 1) return [...list];
  return list.filter((_, i) => i !== index);
}

function dedupe(list: readonly CriterionId[]): CriterionId[] {
  return list.filter((id, i) => list.indexOf(id) === i);
}
