import { describe, expect, test } from "vitest";
import { translate } from "../../i18n";
import type { LayerResultDto } from "../types";
import { toDelimited, toDisplayTable } from "../export/table";
import { csvOptions } from "../export/tableExport";
import { recordsTableModel } from "../export/records";
import {
  abdTable,
  criterionMatrixTable,
  engineeringConstantsTable,
  layerResultsTable,
  lpfPathTable,
  vibrationModesTable,
} from ".";

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("de", key, params);

function rf(value: number, name = "FF") {
  return { minimal_reserve_factor: value, failure_name: name, failure_type: "FiberFailure" as const };
}

function layer(nr: number, lower: number, upper: number, extra?: { id: string; lower: number; upper: number }[]): LayerResultDto {
  const state = { stress: [0, 0, 0] as [number, number, number], strain: [0, 0, 0] as [number, number, number] };
  return {
    layer_number: nr,
    sss_lower: state,
    sss_upper: state,
    sss_lower_global: state,
    sss_upper_global: state,
    rr_lower: rf(lower),
    rr_upper: rf(upper),
    failed: Math.min(lower, upper) < 1,
    governing_lower: "puck",
    governing_upper: "puck",
    by_criterion: (extra ?? []).map((e) => ({ id: e.id, rr_lower: rf(e.lower), rr_upper: rf(e.upper) })),
  } as LayerResultDto;
}

const formats = () => ({ unitId: null, decimals: 3, notation: "fixed" as const });

describe("result tables", () => {
  test("the ply table marks the critical ply and writes the chosen metric", () => {
    const layers = [layer(1, 2, 4), layer(2, 0.5, 0.8)];
    const table = layerResultsTable(layers, { metric: "irf", minOnly: false, t, locale: "de" });
    expect(table.columns.map((c) => c.key)).toEqual([
      "nr", "rf-lower", "mode-lower", "rf-upper", "mode-upper", "criterion", "status",
    ]);
    expect(table.rows[1][0]).toBe("⌖ 2");
    expect(table.rows[1][1]).toBe(2); // IRF of 0.5
    expect(table.rows[1][6]).toBe(t("layerResults.failed"));
  });

  test("the minimum-only ply table keeps the governing surface", () => {
    const table = layerResultsTable([layer(1, 3, 1.5)], { metric: "rf", minOnly: true, t, locale: "de" });
    expect(table.rows[0].slice(1, 3)).toEqual([1.5, t("common.top")]);
  });

  test("the criterion matrix has a column per criterion and leaves unchecked ones empty", () => {
    const layers = [
      layer(1, 1.2, 1.4, [
        { id: "puck", lower: 1.2, upper: 1.4 },
        { id: "max_stress", lower: 2, upper: 3 },
      ]),
      layer(2, 5, 6),
    ];
    const table = criterionMatrixTable(layers, { metric: "rf", t });
    expect(table.columns.map((c) => c.key)).toEqual(["nr", "puck", "max_stress", "governing"]);
    expect(table.rows[0].slice(1, 3)).toEqual([1.2, 2]);
    expect(table.rows[1].slice(1, 3)).toEqual([5, null]);
  });

  test("the ABD table writes the arithmetic's noise as zero", () => {
    const abd = Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: 6 }, (_, j) => (i === j ? 1e5 : i < 3 && j >= 3 ? 1e-13 : 0)),
    );
    const table = abdTable(abd, t);
    expect(table.rows[0]).toEqual(["1", 1e5, 0, 0, 0, 0, 0]);
  });

  test("engineering constants leave the restrained Poisson ratios empty", () => {
    const ec = Object.fromEntries(
      ["ex", "ey", "g", "nuxy", "nuyx"].flatMap((n) =>
        ["simple", "fixed", "bend_simple", "bend_fixed"].map((v) => [`${n}_${v}`, 1]),
      ),
    ) as unknown as Parameters<typeof engineeringConstantsTable>[0];
    const table = engineeringConstantsTable(ec, t);
    expect(table.rows[1].slice(4)).toEqual([null, null]);
    expect(table.rows[0].slice(4)).toEqual([1, 1]);
  });

  test("the LPF path and the frequencies are plain rows", () => {
    const path = lpfPathTable(
      [
        {
          index: 0,
          layerNumber: 3,
          reserveFactor: 1.25,
          failureName: "",
          failureType: "MatrixFailure",
          criterionId: "puck",
          matrixFailedCount: 1,
          fibreFailedCount: 0,
          plyCount: 8,
        },
      ],
      t,
      "de",
    );
    expect(path.rows[0][5]).toBe(1.25);
    expect(vibrationModesTable([10, 25], t).rows[1]).toEqual([2, 25, 2.5]);
  });
});

describe("export settings", () => {
  test("German defaults are a semicolon and a decimal comma, full precision", () => {
    const options = csvOptions({ precision: "full", separator: "auto", decimal: "auto" }, "de", formats);
    expect([options.sep, options.decimal]).toEqual([";", ","]);
    const csv = toDelimited({ title: "", columns: [{ key: "a", label: "A" }], rows: [[1 / 3]] }, options);
    expect(csv).toBe("A\r\n0,3333333333333333\r\n");
  });

  test("a separator equal to the decimal mark is moved out of its way", () => {
    const options = csvOptions({ precision: "display", separator: ",", decimal: "," }, "en", formats);
    expect(options.sep).toBe(";");
  });

  test("an uncategorised column is rounded to its decimals when shown", () => {
    const table = { title: "", columns: [{ key: "a", label: "A", decimals: 1 }], rows: [[2.345]] };
    const options = csvOptions({ precision: "display", separator: "auto", decimal: "auto" }, "de", formats);
    expect(toDelimited(table, options)).toBe("A\r\n2,3\r\n");
    expect(toDisplayTable(table, { locale: "de" }).rows).toEqual([["2,3"]]);
  });

  test("a records table exports the columns that have a value", () => {
    const model = recordsTableModel(
      "T",
      [
        { key: "a", label: "A", value: (r: { a: number }) => r.a },
        { key: "handle", label: "" },
      ],
      [{ a: 1 }, { a: 2 }],
    );
    expect(model.columns.map((c) => c.key)).toEqual(["a"]);
    expect(model.rows).toEqual([[1], [2]]);
  });
});
