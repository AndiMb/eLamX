import { Layers } from "lucide-react";
import { useT, useTx } from "../i18n";

export function WelcomePage() {
  const t = useT();
  const tx = useTx();
  return (
    <section className="panel welcome">
      <div className="empty-state">
        <Layers size={40} strokeWidth={1.25} />
        <h2>{t("welcome.title")}</h2>
        {/* tx() rather than t(): the emphasized "+" sits mid-sentence, and
            the two languages put it in different places. */}
        <p>{tx("welcome.body", { plus: <strong>+</strong> })}</p>
      </div>
    </section>
  );
}
