// Operations on the ply list that act on a selection rather than on one ply:
// moving a block, duplicating it, inserting one. Pure functions over any list
// of things with an id, so the rules - what happens to rows that were not
// next to each other, where a block lands - are tested without a table.

type Item = { id: string };

/** The selected items in list order, however they were selected. */
export function inOrder<T extends Item>(items: T[], ids: ReadonlySet<string>): T[] {
  return items.filter((item) => ids.has(item.id));
}

/**
 * Moves a block of items next to `targetId`: before it or after it. The
 * block is the items in `ids`, in list order and closed up - rows that were
 * not next to each other arrive as one run, which is what dragging several
 * rows means. A target inside the block moves nothing.
 */
export function moveBlock<T extends Item>(
  items: T[],
  ids: ReadonlySet<string>,
  targetId: string,
  placement: "before" | "after",
): T[] {
  if (ids.has(targetId)) return items;
  const block = inOrder(items, ids);
  if (block.length === 0) return items;
  const rest = items.filter((item) => !ids.has(item.id));
  const at = rest.findIndex((item) => item.id === targetId);
  if (at < 0) return items;
  const insertAt = placement === "before" ? at : at + 1;
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

/**
 * Where a drag of `activeId` onto `overId` puts the block: after the target
 * when the drag went down the list, before it when it went up - the same
 * rule the sortable list uses to make room while dragging, so the block
 * lands where the gap was shown.
 */
export function dropPlacement<T extends Item>(items: T[], activeId: string, overId: string): "before" | "after" {
  const from = items.findIndex((item) => item.id === activeId);
  const to = items.findIndex((item) => item.id === overId);
  return to > from ? "after" : "before";
}

/**
 * Moves every selected item one place up (-1) or down (+1), keeping their
 * spacing - Alt+↑/↓. When the block already touches that end of the list,
 * nothing moves: moving only the rows that still can would tear the
 * selection apart.
 */
export function shiftBlock<T extends Item>(items: T[], ids: ReadonlySet<string>, direction: -1 | 1): T[] {
  if (ids.size === 0) return items;
  const edge = direction < 0 ? items[0] : items[items.length - 1];
  if (!edge || ids.has(edge.id)) return items;
  const next = [...items];
  // Walk towards the direction of travel, so each selected item swaps with
  // an unselected neighbour and never with another selected one.
  const order = direction < 0 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i);
  for (const i of order) {
    if (!ids.has(next[i].id)) continue;
    const j = i + direction;
    if (ids.has(next[j].id)) continue;
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/** Inserts `block` before the item at `index` (at the end for `index` past
 *  the last). */
export function insertAt<T>(items: T[], block: T[], index: number): T[] {
  const at = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, at), ...block, ...items.slice(at)];
}

/** Where pasted rows go: above the first selected row, or at the end when
 *  nothing is selected. */
export function pasteIndex<T extends Item>(items: T[], ids: ReadonlySet<string>): number {
  const first = items.findIndex((item) => ids.has(item.id));
  return first < 0 ? items.length : first;
}

/**
 * Copies of the selected items, inserted as one block right after the last
 * selected one. Returns the list and the copies, which become the new
 * selection - the thing one wants to move or edit next.
 */
export function duplicateBlock<T extends Item>(
  items: T[],
  ids: ReadonlySet<string>,
  copy: (item: T) => T,
): { items: T[]; copies: T[] } {
  const block = inOrder(items, ids);
  if (block.length === 0) return { items, copies: [] };
  const last = items.findIndex((item) => item.id === block[block.length - 1].id);
  const copies = block.map(copy);
  return { items: insertAt(items, copies, last + 1), copies };
}

/**
 * The selection after a click on a row, file-manager style: a plain click
 * selects that row alone, Ctrl (Cmd) adds or removes it, Shift selects the
 * range from the anchor - the row clicked last without Shift.
 */
export function clickSelection(
  order: string[],
  current: ReadonlySet<string>,
  anchor: string | null,
  clicked: string,
  { toggle, range }: { toggle: boolean; range: boolean },
): { selection: Set<string>; anchor: string } {
  if (range && anchor !== null && order.includes(anchor)) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(clicked);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const span = order.slice(lo, hi + 1);
    const selection = toggle ? new Set([...current, ...span]) : new Set(span);
    return { selection, anchor };
  }
  if (toggle) {
    const selection = new Set(current);
    if (selection.has(clicked)) selection.delete(clicked);
    else selection.add(clicked);
    return { selection, anchor: clicked };
  }
  return { selection: new Set([clicked]), anchor: clicked };
}
