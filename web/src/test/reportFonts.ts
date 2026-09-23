// The report's two fonts, read from disk for the tests.
import { readFileSync } from "node:fs";

const FONT_DIR = new URL("../lib/report/pdf/fonts/", import.meta.url);

export function reportFonts(): { regular: Uint8Array; bold: Uint8Array } {
  return {
    regular: new Uint8Array(readFileSync(new URL("ElamxSans-Regular.ttf", FONT_DIR))),
    bold: new Uint8Array(readFileSync(new URL("ElamxSans-Bold.ttf", FONT_DIR))),
  };
}
