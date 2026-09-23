import { afterEach, describe, expect, it, vi } from "vitest";
import { kindOf, saveFile } from "./saveFile";
import type { DesktopBridge } from "./desktop";

describe("saveFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("liest die Dateiart aus der Endung", () => {
    expect(kindOf("platte-2x.png")).toBe("png");
    expect(kindOf("Tabelle.CSV")).toBe("csv");
    expect(kindOf("bericht.pdf")).toBe("pdf");
    expect(kindOf("projekt.elamx")).toBeNull();
    expect(kindOf("ohne")).toBeNull();
  });

  /// In the shell the dialog's filters come from the file name unless the
  /// caller names them - and a shell that predates `saveFile` still saves.
  it("reicht im Desktop Bytes, Namen und Dateiarten an die Shell weiter", async () => {
    const saveFileSpy = vi.fn(async () => "C:/x.csv");
    const saveImage = vi.fn(async () => "C:/x.png");
    vi.stubGlobal("window", { elamxDesktop: { saveFile: saveFileSpy, saveImage } as Partial<DesktopBridge> });

    const blob = new Blob(["a;b\n1;2\n"]);
    expect(await saveFile(blob, "werte.csv")).toBe("C:/x.csv");
    expect(saveFileSpy).toHaveBeenCalledWith(expect.any(Uint8Array), "werte.csv", ["csv"]);
    await saveFile(blob, "bild", ["svg", "png"]);
    expect(saveFileSpy).toHaveBeenLastCalledWith(expect.any(Uint8Array), "bild", ["svg", "png"]);

    vi.stubGlobal("window", { elamxDesktop: { saveImage } as Partial<DesktopBridge> });
    expect(await saveFile(blob, "alt.png")).toBe("C:/x.png");
    expect(saveImage).toHaveBeenCalledOnce();
  });
});
