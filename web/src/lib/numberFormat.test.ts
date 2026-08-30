import { describe, expect, it } from "vitest";
import {
  formatFixed,
  formatMatrixEntry,
  formatNumber,
  formatScientific,
  formatSignificant,
  isFiniteResult,
  matrixScale,
  NEGLIGIBLE_FRACTION,
  NO_VALUE,
  parseLocaleNumber,
} from "./numberFormat";

describe("parseLocaleNumber", () => {
  it("accepts both decimal separators regardless of the UI language", () => {
    expect(parseLocaleNumber("1234.5")).toBe(1234.5);
    expect(parseLocaleNumber("1234,5")).toBe(1234.5);
    expect(parseLocaleNumber("-2.5e-3")).toBe(-0.0025);
  });

  it("returns null for a value still being typed, so the field is left alone", () => {
    for (const text of ["", "-", ".", "-.", "1e", "abc"]) {
      expect(parseLocaleNumber(text)).toBeNull();
    }
  });
});

describe("the display formatters", () => {
  it("follow the UI's locale, not the machine's", () => {
    expect(formatFixed(1234.5, 1, "en")).toBe("1,234.5");
    expect(formatFixed(1234.5, 1, "de")).toBe("1.234,5");
  });

  it("never write a bare point where the locale wants a comma", () => {
    // The finding that started this: "3.019e+4" beside "0,40" put the same
    // character in two meanings on one screen.
    for (const formatted of [
      formatScientific(30190, 3, "de"),
      formatFixed(0.4, 2, "de"),
      formatSignificant(1.23456, 4, "de"),
    ]) {
      expect(formatted).not.toMatch(/\d\.\d/);
    }
  });

  it("report a non-finite solver result instead of crashing on it", () => {
    // serde_json writes null for NaN/Infinity, so these arrive in fields the
    // DTOs type as number.
    for (const value of [null, undefined, NaN, Infinity]) {
      expect(formatFixed(value as number, 2, "en")).toBe(NO_VALUE);
      expect(formatScientific(value as number, 2, "en")).toBe(NO_VALUE);
      expect(formatSignificant(value as number, 2, "en")).toBe(NO_VALUE);
      expect(formatNumber(value as number, { decimals: 2, notation: "fixed" }, "en")).toBe(NO_VALUE);
      expect(isFiniteResult(value as number)).toBe(false);
    }
  });
});

describe("the matrix zero threshold", () => {
  const abd = [
    [1.2e5, 4.0e4, 0],
    [4.0e4, 1.2e5, 0],
    [0, 0, 3.0e4],
  ];

  it("scales against the matrix's own largest entry", () => {
    expect(matrixScale(abd)).toBe(1.2e5);
    expect(matrixScale([[NaN, 3], [-7, 2]])).toBe(7);
  });

  it("prints arithmetic noise as zero", () => {
    // A balanced laminate's B block is exactly zero but comes back as ~1e-13.
    const noise = 1e-13;
    expect(noise).toBeLessThan(NEGLIGIBLE_FRACTION * matrixScale(abd));
    expect(formatMatrixEntry(noise, matrixScale(abd), 3, "de")).toBe("0,0");
  });

  it("still prints a small but real entry", () => {
    const real = 1.5;
    expect(formatMatrixEntry(real, matrixScale(abd), 3, "en")).toMatch(/1\.500/);
  });

  it("passes a non-finite entry through as no value", () => {
    expect(formatMatrixEntry(null, 1, 3, "en")).toBe(NO_VALUE);
  });
});
