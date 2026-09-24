import type { ReactNode } from "react";

// One card with a head: the title on the left, the card's own tools - copy,
// CSV, export, a view switch - on the right of the same line.
//
// Before this every card placed its tools where the content happened to end:
// a copy button on a row of its own above a table, a download icon on a row
// of its own under a chart, far away at the card's right edge from a table
// that stopped at a third of it. Each was a strip of white with one icon in
// it. In the head they cost no height, sit in the same place on every card,
// and belong visibly to the whole card.

export function Panel({
  title,
  tools,
  className,
  children,
}: {
  title?: ReactNode;
  tools?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `panel ${className}` : "panel"}>
      {title !== undefined && (
        <div className="panel-head">
          <h2>{title}</h2>
          {tools && <div className="panel-tools">{tools}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
