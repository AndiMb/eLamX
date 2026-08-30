import { TriangleAlert } from "lucide-react";
import type { PlateCheck } from "../lib/plateChecks";
import { useT } from "../i18n";

// Renders the plate guard rails from lib/plateChecks, one severity at a time,
// because the two belong in different places: an error replaces the result,
// a warning stands next to it.
export function PlateCheckList({
  checks,
  severity,
}: {
  checks: PlateCheck[];
  severity: PlateCheck["severity"];
}) {
  const t = useT();
  const shown = checks.filter((c) => c.severity === severity);
  if (shown.length === 0) return null;

  return (
    <>
      {shown.map((check) => (
        <p key={check.message} className={severity === "error" ? "error" : "hint"}>
          <TriangleAlert size={14} /> {t(check.message)}
        </p>
      ))}
    </>
  );
}
