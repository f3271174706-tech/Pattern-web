import { createDemo, defaultLayout } from "./demo";
import palette from "../../../examples/palettes/mard221.json";
import type { BeadPattern } from "./types";
export function createMardDemo(): BeadPattern {
  const p = createDemo();
  // Explicitly authored example using selected IDs from the supplied workbook.
  // This does not convert or rebind an existing user's pattern.
  const codes: Record<string, string> = {
    D01: "H7",
    D02: "B12",
    D03: "B15",
    D04: "A1",
    D05: "G7",
    D06: "H2",
    D07: "G3",
    D08: "E2",
  };
  p.patternId = "mard-garden-58";
  p.title = "窗台小花园 · MARD";
  p.palette = structuredClone(palette);
  p.grid.cells = p.grid.cells.map((row) =>
    row.map((code) => (code === null ? null : codes[code])),
  );
  return p;
}

export function createMardSmallDemo(): BeadPattern {
  return {
    schemaVersion: "1.0", patternId: "mard-demo-3x2", revision: 1,
    title: "MARD 221 · 3×2 示例", source: {producer: "Workbench MARD example"},
    grid: {width: 3, height: 2, origin: "top-left", coordinateBase: 1,
      cells: [["A1", "A1", null], ["G7", "A1", "G7"]]},
    palette: structuredClone(palette), layout: structuredClone(defaultLayout)
  };
}
