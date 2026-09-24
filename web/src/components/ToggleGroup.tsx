import type { ReactNode } from "react";

// Several independent on/off switches for what a view shows, drawn as one
// row of buttons - the multi-select sibling of `.segmented`.
//
// The rule behind it: a checkbox is for data, a button for the view. A row of
// checkboxes beside a row of segmented switches reads as a form in the middle
// of a toolbar, and twelve of them in a line (the polar diagram's series) is
// a form nobody fills in. As buttons they have the toolbar's height, its
// look, and state that is visible at a glance.

export interface ToggleItem<K extends string> {
  key: K;
  label: ReactNode;
  /** A mark in front of the label - a series' colour, for example. */
  swatch?: ReactNode;
  title?: string;
}

export function ToggleGroup<K extends string>({
  items,
  isOn,
  onToggle,
  label,
  className,
}: {
  items: readonly ToggleItem<K>[];
  isOn: (key: K) => boolean;
  onToggle: (key: K) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}) {
  return (
    <div className={className ? `segmented toggle-group ${className}` : "segmented toggle-group"} role="group" aria-label={label}>
      {items.map((item) => {
        const on = isOn(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={on}
            className={on ? "active" : undefined}
            title={item.title}
            onClick={() => onToggle(item.key)}
          >
            {item.swatch}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
