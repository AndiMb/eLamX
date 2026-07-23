import { Layers } from "lucide-react";

export function WelcomePage() {
  return (
    <section className="panel">
      <div className="empty-state">
        <Layers size={40} strokeWidth={1.25} />
        <h2>Willkommen bei eLamX</h2>
        <p>
          Wähle links ein Laminat oder ein Material aus, oder lege über die{" "}
          <strong>+</strong>-Schaltflächen im Baum ein neues an. Alle Ergebnisse
          aktualisieren sich live bei jeder Eingabe.
        </p>
      </div>
    </section>
  );
}
