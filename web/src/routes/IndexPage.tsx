import { useIsMobile } from "../lib/useIsMobile";
import { WelcomePage } from "./WelcomePage";
import { MobileLaminateListPage } from "./MobileLaminateListPage";

// Same route ("/"), different content by shell: desktop already has the
// sidebar tree, so "/" is just a welcome/empty state; mobile has no tree, so
// "/" (the "Laminate" bottom tab) must double as the laminate list itself.
export function IndexPage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileLaminateListPage /> : <WelcomePage />;
}
