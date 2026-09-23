// Drag and drop for the ply table, on @dnd-kit.
//
// A library rather than HTML5 drag and drop: the native API has no touch
// support on phones, no keyboard alternative and nothing for screen readers,
// and dnd-kit brings all three - the pointer and touch sensors, a keyboard
// sensor (Space to pick up, arrows, Space to drop, Escape to cancel), and
// live-region announcements, which are given the app's language here.
//
// The table itself stays a ResponsiveTable; this file supplies the row shell
// that makes each row sortable, the handle, and the context around them.

import { createContext, useContext, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { RowShellProps } from "./ResponsiveTable";
import { LayerTableContext } from "./layerTableContext";
import { useT } from "../i18n";

interface SortableRow {
  listeners: ReturnType<typeof useSortable>["listeners"];
  attributes: ReturnType<typeof useSortable>["attributes"];
  setActivatorNodeRef: (element: HTMLElement | null) => void;
}

const SortableRowContext = createContext<SortableRow | null>(null);

/** Clicks on these select nothing: they are the row's own controls. */
const INTERACTIVE = "input, select, textarea, button, a, label, summary, [role=button]";

/** A row that can be dragged by its handle; used as ResponsiveTable's
 *  `RowShell`. */
export function SortableRowShell<T extends { id: string }>({ row, kind, className, children }: RowShellProps<T>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });
  const table = useContext(LayerTableContext);
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const classes = [
    className,
    table.selected.has(row.id) ? "selected" : null,
    isDragging ? "dragging" : null,
    // The other rows of a block being dragged: they move when it drops.
    !isDragging && table.dragging?.has(row.id) ? "drag-companion" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const context = useMemo(
    () => ({ attributes, listeners, setActivatorNodeRef }),
    [attributes, listeners, setActivatorNodeRef],
  );
  const onClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    table.onRowClick(row.id, event);
  };
  const props = {
    ref: setNodeRef,
    style,
    className: classes || undefined,
    "data-layer-id": row.id,
    "aria-selected": table.selected.has(row.id),
  };
  return (
    <SortableRowContext.Provider value={context}>
      {kind === "tr" ? (
        <tr {...props} onClick={onClick}>
          {children}
        </tr>
      ) : kind === "details" ? (
        <details {...props}>{children}</details>
      ) : (
        <div {...props} onClick={onClick}>
          {children}
        </div>
      )}
    </SortableRowContext.Provider>
  );
}

/** The grip a row is dragged by. Outside a sortable row it renders nothing. */
export function DragHandle({ label }: { label: string }) {
  const sortable = useContext(SortableRowContext);
  if (!sortable) return null;
  const { attributes, listeners, setActivatorNodeRef } = sortable;
  return (
    <button
      type="button"
      className="icon-button drag-handle"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title={label}
      // Inside a card's <summary> a tap would otherwise open the card.
      onClick={(event) => event.preventDefault()}
    >
      <GripVertical size={14} />
    </button>
  );
}

// Plies move up and down, never sideways.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * The drag-and-drop context for a list of rows. `onMove` is called once, on
 * drop, with the row that was dragged and the row it was dropped on.
 */
export function SortableLayers({
  ids,
  onDragStart,
  onMove,
  onDragCancel,
  children,
}: {
  ids: string[];
  onDragStart: (activeId: string) => void;
  onMove: (activeId: string, overId: string) => void;
  onDragCancel: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const sensors = useSensors(
    // A few pixels of travel before a press becomes a drag, so a click on the
    // handle is still a click.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // On a phone a short hold, so a swipe over the handle still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("layers.dnd.pickedUp", { nr: position(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("layers.dnd.over", { nr: position(active.id), pos: position(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("layers.dnd.dropped", { nr: position(active.id), pos: position(over.id) })
        : t("layers.dnd.cancelled", { nr: position(active.id) }),
    onDragCancel: ({ active }) => t("layers.dnd.cancelled", { nr: position(active.id) }),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("layers.dnd.instructions") } }}
      onDragStart={(event: DragStartEvent) => onDragStart(String(event.active.id))}
      onDragEnd={(event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
        else onDragCancel();
      }}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}
