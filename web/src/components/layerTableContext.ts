// What the rows of the ply table need from the table they are in - in its
// own module, since a component file should only export components.
import { createContext, type MouseEvent } from "react";

/** What the rows need from the table they are in. */
export interface LayerTableState {
  selected: ReadonlySet<string>;
  /** The rows being dragged along with the one under the pointer. */
  dragging: ReadonlySet<string> | null;
  onRowClick: (id: string, event: MouseEvent) => void;
}

export const LayerTableContext = createContext<LayerTableState>({
  selected: new Set(),
  dragging: null,
  onRowClick: () => {},
});
