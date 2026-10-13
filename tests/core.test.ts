import { describe, it, expect } from "vitest";
import {
  applyEdits,
  calculateStats,
  diffPatterns,
  parsePattern,
  validatePattern,
  statsCsv,
} from "../packages/core/src/index";
import { createDemo, createSmallDemo } from "../packages/core/src/demo";

describe("BeadPattern v1 core acceptance", () => {
  it("counts a selected range exactly while retaining original board identities", () => {
    const p = createSmallDemo();
    const s = calculateStats(p, { x1: 2, y1: 1, x2: 3, y2: 1 });
    expect(s).toMatchObject({totalCells: 2, beadCount: 1, emptyCount: 1});
    expect(s.colors.map(c=>[c.code,c.count])).toEqual([["C01",1]]);
    const large = calculateStats(createDemo(), {x1:28,y1:28,x2:30,y2:30});
    expect(large.boards.map(b=>b.id)).toEqual(["B1-1","B1-2","B2-1","B2-2"]);
    expect(large.boards.reduce((sum,b)=>sum+b.totalCells,0)).toBe(9);
    expect(large.beadCount + large.emptyCount).toBe(9);
  });
  it("counts the specified 3×2 matrix exactly", () => {
    const s = calculateStats(createSmallDemo());
    expect(s).toMatchObject({
      totalCells: 6,
      beadCount: 5,
      emptyCount: 1,
      colorCount: 2,
    });
    expect(s.colors.map((c) => [c.code, c.count])).toEqual([
      ["C01", 3],
      ["C02", 2],
    ]);
  });
  it("changes only one cell without mutating the input", () => {
    const p = createSmallDemo();
    const { pattern, preview } = applyEdits(p, {
      baseRevision: 1,
      operations: [
        { type: "set_cell", x: 1, y: 1, expectedColor: "C01", newColor: "C02" },
      ],
    });
    expect(preview.changedCells).toBe(1);
    expect(
      calculateStats(pattern).colors.map((c) => [c.code, c.count]),
    ).toEqual([
      ["C02", 3],
      ["C01", 2],
    ]);
    expect(p.grid.cells[0][0]).toBe("C01");
    expect(preview.beadDelta).toBe(0);
  });
  it("counts white as a bead and null as empty", () => {
    const p = createSmallDemo();
    p.grid.cells[0][2] = "WHITE";
    expect(calculateStats(p).beadCount).toBe(6);
    expect(calculateStats(p).emptyCount).toBe(0);
  });
  it("rejects expectedColor mismatch atomically including preceding operations", () => {
    const p = createSmallDemo(),
      before = JSON.stringify(p);
    expect(() =>
      applyEdits(p, {
        baseRevision: 1,
        operations: [
          { type: "set_cell", x: 2, y: 1, newColor: null },
          {
            type: "set_cell",
            x: 1,
            y: 2,
            expectedColor: "C01",
            newColor: null,
          },
        ],
      }),
    ).toThrow(/预期/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it("partitions 58×58 at 29×29 without overlaps or omissions", () => {
    const p = createDemo(),
      s = calculateStats(p);
    expect(s.boards).toHaveLength(4);
    const seen = new Set();
    for (const b of s.boards)
      for (let y = b.rect.y1; y <= b.rect.y2; y++)
        for (let x = b.rect.x1; x <= b.rect.x2; x++) {
          expect(seen.has(`${x},${y}`)).toBe(false);
          seen.add(`${x},${y}`);
        }
    expect(seen.size).toBe(58 * 58);
    expect(s.boards.reduce((a, b) => a + b.beadCount, 0)).toBe(s.beadCount);
    expect(s.colors.reduce((a, b) => a + b.count, 0) + s.emptyCount).toBe(
      s.totalCells,
    );
  });
  it("strictly validates matrix dimensions, colors, schema version, and fields", () => {
    const p = createSmallDemo();
    validatePattern(p);
    expect(() => parsePattern({ ...p, schemaVersion: "2.0" })).toThrow(/1.0/);
    expect(() => parsePattern({ ...p, unknown: 1 })).toThrow();
    p.grid.cells[0].push(null);
    expect(() => validatePattern(p)).toThrow(/width/);
    p.grid.cells[0].pop();
    p.grid.cells[0][0] = "FAKE";
    expect(() => validatePattern(p)).toThrow(/FAKE/);
  });
  it("validates coordinates and target colors", () => {
    const p = createSmallDemo();
    expect(() =>
      applyEdits(p, {
        baseRevision: 1,
        operations: [{ type: "set_cell", x: 0, y: 1, newColor: "C01" }],
      }),
    ).toThrow(/坐标/);
    expect(() =>
      applyEdits(p, {
        baseRevision: 1,
        operations: [{ type: "set_cell", x: 1, y: 1, newColor: "UNKNOWN" }],
      }),
    ).toThrow(/未知/);
  });
  it("preserves empty cells on non-empty region fill, and previews exact deltas", () => {
    const p = createSmallDemo();
    const { pattern, preview } = applyEdits(p, {
      baseRevision: 1,
      operations: [
        {
          type: "fill_rect",
          rect: { x1: 1, y1: 1, x2: 3, y2: 2 },
          newColor: "C02",
          nonEmptyOnly: true,
        },
      ],
    });
    expect(pattern.grid.cells[0][2]).toBeNull();
    expect(preview.colorDeltas).toEqual({ C01: -3, C02: 3 });
    expect(preview.beadDelta).toBe(0);
    expect(diffPatterns(p, pattern)).toHaveLength(3);
  });
  it("limits region replacement to its rectangle and supports replacing null", () => {
    const p = createSmallDemo();
    const result = applyEdits(p, {
      baseRevision: 1,
      operations: [
        {
          type: "replace_color_in_rect",
          rect: { x1: 1, y1: 1, x2: 2, y2: 1 },
          oldColor: "C01",
          newColor: "C02",
        },
        { type: "replace_color", oldColor: null, newColor: "WHITE" },
      ],
    });
    expect(result.preview.changedCells).toBe(3);
    expect(result.pattern.grid.cells[1][1]).toBe("C01");
    expect(result.preview.beadDelta).toBe(1);
  });
  it("rejects stale revision and unknown operations", () => {
    expect(() =>
      applyEdits(createSmallDemo(), { baseRevision: 0, operations: [] }),
    ).toThrow(/当前版本/);
    expect(() =>
      applyEdits(createSmallDemo(), {
        baseRevision: 1,
        operations: [{ type: "hack" } as never],
      }),
    ).toThrow();
  });
  it("calculates and edits a 200×200 pattern within a practical budget", () => {
    const p = createSmallDemo();
    p.grid.width = p.grid.height = 200;
    p.grid.cells = Array.from({ length: 200 }, () => Array(200).fill("C01"));
    const start = performance.now();
    const r = applyEdits(p, {
      baseRevision: 1,
      operations: [{ type: "replace_color", oldColor: "C01", newColor: "C02" }],
    });
    expect(r.preview.changedCells).toBe(40000);
    expect(calculateStats(r.pattern).beadCount).toBe(40000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
  it("escapes CSV formula injection and preserves revisions", () => {
    const p = createSmallDemo();
    p.palette.colors.C01.name = "=SUM(1,1)";
    const csv = statsCsv(calculateStats(p));
    expect(csv).toContain("'=SUM(1,1)");
    expect(csv).toContain('"revision"');
  });
});
