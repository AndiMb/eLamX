import { HashRouter, Routes, Route } from "react-router-dom";
import { useIsMobile } from "./lib/useIsMobile";
import { useApplyTheme } from "./lib/useApplyTheme";
import { useApplyLocale } from "./i18n/useApplyLocale";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { BottomTabs } from "./components/BottomTabs";
import { IndexPage } from "./routes/IndexPage";
import { LaminatePage } from "./routes/LaminatePage";
import { ModulePage } from "./routes/ModulePage";
import { MaterialPage } from "./routes/MaterialPage";
import { MaterialListPage } from "./routes/MaterialListPage";
import { FormatSettingsPage } from "./routes/FormatSettingsPage";
import "./App.css";

function AppRoutes() {
  return (
    <Routes>
      <Route index element={<IndexPage />} />
      <Route path="/laminates/:laminateId" element={<LaminatePage />} />
      <Route path="/laminates/:laminateId/modules/:moduleId" element={<ModulePage />} />
      <Route path="/materials" element={<MaterialListPage />} />
      <Route path="/materials/:materialId" element={<MaterialPage />} />
      <Route path="/settings/format" element={<FormatSettingsPage />} />
    </Routes>
  );
}

// useIsMobile() branch at the shell (this component), not scattered checks:
// desktop keeps the split-view (sidebar tree + content); mobile swaps the
// tree for a fixed bottom tab bar and lets each route's own page double as a
// full-screen stack entry. Both shells share the TopBar (UI-Konzept §4).
function Shell() {
  const isMobile = useIsMobile();
  useApplyTheme();
  useApplyLocale();

  if (isMobile) {
    return (
      <div className="app mobile">
        <TopBar />
        <div className="app-body">
          <div className="content mobile-content">
            <AppRoutes />
          </div>
        </div>
        <BottomTabs />
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <div className="content">
          <AppRoutes />
        </div>
      </div>
    </div>
  );
}

// HashRouter (not BrowserRouter): this will eventually ship as a bundled
// desktop/mobile app (Tauri/Capacitor), where there is no server to configure
// a deep-link fallback for nested routes - hash-based routing needs none.
export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
