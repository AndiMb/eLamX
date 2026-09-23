import { lazy, Suspense, useEffect } from "react";
import { useAtom } from "jotai";
import { registerCommand } from "../lib/commands";
import { reportDialogOpenAtom } from "../store/reportAtoms";

// The report as a command - from the palette, the desktop menu and the top
// bar's button - and the dialog it opens. The dialog is its own chunk: it is
// the door to the report, and none of what is behind it belongs in the
// bundle every visit loads.
const ReportDialog = lazy(() => import("./ReportDialog").then((m) => ({ default: m.ReportDialog })));

export function ReportLauncher() {
  const [open, setOpen] = useAtom(reportDialogOpenAtom);

  useEffect(
    () =>
      registerCommand({
        id: "report.create",
        label: "command.report",
        run: () => setOpen(true),
      }),
    [setOpen],
  );

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ReportDialog onClose={() => setOpen(false)} />
    </Suspense>
  );
}
