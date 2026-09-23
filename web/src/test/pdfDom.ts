// What svg2pdf needs from a browser, for rendering a PDF in a test.
//
// svg2pdf walks an SVG Element tree and reads the global `document`, so jsdom
// supplies both. It also measures text - with a canvas or `getBBox` - to place
// centred and right-aligned labels, and jsdom has neither; both are answered
// with jsPDF's own metrics of the embedded font, which is what the PDF uses
// anyway. MathJax needs no DOM at all.
import { JSDOM } from "jsdom";
import { jsPDF } from "jspdf";

/** Installs the DOM stand-in; returns the parser the renderer is handed. */
export function installPdfDom(fonts: { regular: Uint8Array; bold: Uint8Array }): (source: string) => Element {
  const { window } = new JSDOM("");
  Object.assign(globalThis, { document: window.document });

  const metrics = new jsPDF();
  const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
  metrics.addFileToVFS("r.ttf", b64(fonts.regular));
  metrics.addFont("r.ttf", "ElamxSans", "normal");
  metrics.addFileToVFS("b.ttf", b64(fonts.bold));
  metrics.addFont("b.ttf", "ElamxSans", "bold");
  const width = (text: string, sizePx: number, bold: boolean) => {
    metrics.setFont("ElamxSans", bold ? "bold" : "normal");
    return metrics.getStringUnitWidth(text) * sizePx;
  };
  (window.HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
    return {
      font: "",
      measureText(this: { font: string }, text: string) {
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16);
        return { width: width(text, size, /bold|[6-9]00/.test(this.font)) };
      },
    };
  };
  (window.SVGElement.prototype as unknown as { getBBox: unknown }).getBBox = function (this: Element) {
    const size = parseFloat(this.getAttribute("font-size") ?? "16");
    const bold = /bold|[6-9]00/.test(this.getAttribute("font-weight") ?? "");
    return { x: 0, y: 0, width: width(this.textContent ?? "", size, bold), height: size };
  };
  const parser = new window.DOMParser();
  return (source) => parser.parseFromString(source, "image/svg+xml").documentElement;
}
