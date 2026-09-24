import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";
import { saveFile } from "../lib/saveFile";

// What the reader sees instead of a blank window when a page throws while it
// renders.
//
// React unmounts everything below the nearest boundary on such an error, and
// without one that is the whole app. Worse, most of the state is read from
// localStorage when the app starts, so an error that comes from a stored value
// - an input saved in a shape a later version no longer reads - comes back on
// every reload, and the only way out would be the browser's developer tools.
// Hence the two ways out offered here besides reloading: keep a copy of what
// is stored, and start again without it.

/** Every key the app writes starts with this. */
const STORAGE_PREFIX = "elamx.";

/** Kept through a reset: they are settings of the reader's, not of the
 *  project, and cannot be what broke. */
const KEPT_KEYS = new Set(["elamx.locale", "elamx.theme"]);

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

/** Everything the app has stored, as one JSON file - the raw values, so that
 *  nothing is lost to a parse that may itself be what fails. */
async function downloadStoredState() {
  const snapshot: Record<string, string | null> = {};
  for (const key of storedKeys()) snapshot[key] = localStorage.getItem(key);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  await saveFile(blob, "elamx-browser-storage.json", ["json"]);
}

function resetStoredState() {
  for (const key of storedKeys()) {
    if (!KEPT_KEYS.has(key)) localStorage.removeItem(key);
  }
  location.hash = "";
  location.reload();
}

interface Props {
  children: ReactNode;
  /** Whether the boundary sits inside the app's shell - a page failed, the
   *  sidebar and the top bar are still there - or around all of it. */
  scope: "page" | "app";
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallback error={error} scope={this.props.scope} />;
  }
}

function ErrorFallback({ error, scope }: { error: Error; scope: "page" | "app" }) {
  return (
    <div className={`error-fallback error-fallback-${scope}`} role="alert">
      <h2>{t("errorBoundary.title")}</h2>
      <p>{t(scope === "page" ? "errorBoundary.page" : "errorBoundary.app")}</p>
      <pre className="error-fallback-message">{error.message}</pre>
      <div className="error-fallback-actions">
        <button type="button" className="btn-primary" onClick={() => location.reload()}>
          {t("errorBoundary.reload")}
        </button>
        {scope === "page" && (
          <button
            type="button"
            onClick={() => {
              location.hash = "";
              location.reload();
            }}
          >
            {t("errorBoundary.home")}
          </button>
        )}
      </div>
      <details className="error-fallback-reset">
        <summary>{t("errorBoundary.persists")}</summary>
        <p>{t("errorBoundary.resetHint")}</p>
        <div className="error-fallback-actions">
          <button type="button" onClick={() => void downloadStoredState()}>
            {t("errorBoundary.download")}
          </button>
          <button type="button" className="btn-danger" onClick={resetStoredState}>
            {t("errorBoundary.reset")}
          </button>
        </div>
      </details>
    </div>
  );
}
