// TeX to a standalone SVG, for the report's formulas.
//
// MathJax 4 rather than the KaTeX the app shows formulas with: KaTeX writes
// HTML that a browser lays out with its own fonts, and a PDF has no browser.
// MathJax's SVG output is paths - every glyph an outline - so the PDF needs no
// math font at all and looks the same wherever it is opened. It runs without
// a DOM (liteAdaptor), so the same code works in a test under Node.
//
// The price is that a formula in the PDF is a drawing, not text: it cannot be
// searched or copied. The prose around it can.
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";

// MathJax 4 splits its font into ranges (operators, arrows, bold, ...) that it
// loads when a formula first needs one, through `mathjax.asyncLoad`. The glob
// makes each range its own chunk shipped with the app, so this stays offline
// and a report only ever fetches the ranges its formulas use. Only ranges an
// engineering report can plausibly need are shipped: all sixty would add
// about 12 MB to the offline bundle.
const fontRanges = import.meta.glob(
  "/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/{latin,latin-b,latin-i,latin-bi,greek,math,arrows,accents,symbols,shapes,double-struck,calligraphic,variants}.js",
);

mathjax.asyncLoad = (name: string) => {
  const range = /dynamic\/([\w-]+)\.js$/.exec(name)?.[1];
  const load = fontRanges[`/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/${range}.js`];
  if (!load) return Promise.reject(new Error(`MathJax font range not shipped: ${name}`));
  return load();
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams"] }),
  // No font cache: every glyph is written as its own path. A cache would put
  // them in <defs> and reference them with <use>, which svg2pdf handles but
  // which makes each formula depend on defs a later one may not carry.
  OutputJax: new SVG({ fontData: MathJaxNewcmFont, fontCache: "none" }),
});

export interface MathSvg {
  svg: string;
  /** Size in em - one em being the font size the formula is set at. */
  widthEm: number;
  heightEm: number;
}

/** A TeX formula as SVG markup, black, sized in em. Rejects on a TeX error
 *  rather than drawing MathJax's red error box into a report. */
export async function texToSvg(tex: string, display = true): Promise<MathSvg> {
  // convertPromise waits for any font range the formula needs.
  const node = await mathDocument.convertPromise(tex, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
  const svgNode = adaptor.firstChild(node) as Parameters<typeof adaptor.outerHTML>[0];
  let svg = adaptor.outerHTML(svgNode);
  if (svg.includes('data-mjx-error') || svg.includes("merror")) {
    const message = /data-mjx-error="([^"]*)"/.exec(svg)?.[1] ?? "TeX error";
    throw new Error(`${message}: ${tex}`);
  }
  const box = (adaptor.getAttribute(svgNode, "viewBox") as string).split(/\s+/).map(Number);
  // svg2pdf does not resolve currentColor, and wants a size without `ex`.
  svg = svg
    .replace(/currentColor/g, "#000000")
    .replace(/ width="[^"]*ex"/, ` width="${box[2] / 1000}"`)
    .replace(/ height="[^"]*ex"/, ` height="${box[3] / 1000}"`);
  if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return { svg, widthEm: box[2] / 1000, heightEm: box[3] / 1000 };
}
