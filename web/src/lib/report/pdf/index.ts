// The PDF renderer's entry in the browser - and the root of its lazy chunk.
//
// Imported only with `import()`, when a report is actually made: jsPDF,
// svg2pdf, autotable and MathJax are close to 2 MB and have no business in the
// bundle the app starts with. The fonts are separate assets beside the chunk,
// fetched from the app's own origin, so this works offline in a browser and
// from the desktop shell's app:// scheme alike.
import regularUrl from "./fonts/ElamxSans-Regular.ttf?url";
import boldUrl from "./fonts/ElamxSans-Bold.ttf?url";
import type { ReportDoc } from "../model";
import { FONT, renderPdf, type RenderEnv } from "./render";

let fonts: Promise<RenderEnv["fonts"]> | null = null;

async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The two fonts, fetched once, and registered with the page as well: svg2pdf
 *  measures text in the browser to place centred and right-aligned labels,
 *  and the measurement has to be made with the font the PDF will use. */
function loadFonts(): Promise<RenderEnv["fonts"]> {
  fonts ??= (async () => {
    const [regular, bold] = await Promise.all([bytes(regularUrl), bytes(boldUrl)]);
    for (const face of [
      new FontFace(FONT, regular.slice().buffer, { weight: "400" }),
      new FontFace(FONT, bold.slice().buffer, { weight: "700" }),
    ]) {
      document.fonts.add(await face.load());
    }
    return { regular, bold };
  })().catch((error) => {
    fonts = null;
    throw error;
  });
  return fonts;
}

export async function renderReportPdf(
  doc: ReportDoc,
  env: Omit<RenderEnv, "fonts" | "parseSvg">,
): Promise<Blob> {
  const parser = new DOMParser();
  const pdf = await renderPdf(doc, {
    ...env,
    fonts: await loadFonts(),
    parseSvg: (source) => parser.parseFromString(source, "image/svg+xml").documentElement,
  });
  return new Blob([pdf.slice().buffer], { type: "application/pdf" });
}
