import { it, expect } from "vitest";
import { previewPatternImport } from "../packages/core/src/import-pattern";
import { parsePattern, calculateStats } from "../packages/core/src/index";
import { legacyPattern } from "./fixtures/legacy-pattern";
import { PatternStore } from "../apps/api/src/store";
import { buildApp } from "../apps/api/src/app";

it("converts legacy metadata without changing any matrix cells, counts or positions", () => {
  const original = legacyPattern();
  const result = previewPatternImport(original, { patternId: "converted", paletteMode: "mard221" });
  expect(result.pattern.grid.cells).toEqual(original.grid);
  expect(result.pattern.grid.coordinateBase).toBe(1);
  expect(calculateStats(result.pattern)).toMatchObject({ beadCount: 5, emptyCount: 1, colorCount: 3 });
  expect(result.paletteConflicts).toEqual([
    { code: "H2", sourceHex: "#FFFFFF", mardHex: "#FEFFFF", count: 2 },
    { code: "H6", sourceHex: "#2C2C2C", mardHex: "#2F2B2F", count: 1 },
  ]);
  expect(result.pattern.palette.colors.H2.hex).toBe("#FEFFFF");
  expect(Object.keys(result.pattern.palette.colors)).toHaveLength(221);
  expect(original.palette.H2.hex).toBe("#FFFFFF");
});
it("preserves source HEX under a distinct palette identity unless rebinding is explicit", () => {
  const result = previewPatternImport(legacyPattern(), { patternId: "source" });
  expect(result.pattern.palette.id).toBe("MARD-221-source");
  expect(result.pattern.palette.colors.H2.hex).toBe("#FFFFFF");
  expect(() => parsePattern(legacyPattern())).toThrow("BeadPattern v1");
  expect(parsePattern(result.pattern)).toEqual(result.pattern);
});
it("checks actual dimensions and referenced source colors before rebinding", () => {
  const wrongSize = legacyPattern(); wrongSize.width = 4;
  expect(() => previewPatternImport(wrongSize, { patternId: "bad" })).toThrow("width");
  const missing = legacyPattern(); missing.grid[0][0] = "A1";
  expect(() => previewPatternImport(missing, { patternId: "bad", paletteMode: "mard221" })).toThrow("A1");
  expect(() => previewPatternImport({ ...legacyPattern(), orientation: "mirror" }, { patternId: "bad" })).toThrow("旧版图纸字段无效");
  expect(() => previewPatternImport({ ...legacyPattern(), schema_version: 2 }, { patternId: "bad" })).toThrow("旧版图纸字段无效");
});
it("recomputes stale totals and counts from the matrix and reports discrepancies", () => {
  const source = legacyPattern(); source.total_beads = 99; source.color_count = 1; source.palette.H2.count = 100;
  const result = previewPatternImport(source, { patternId: "stale" });
  expect(calculateStats(result.pattern).beadCount).toBe(5);
  expect(result.warnings).toHaveLength(4);
});
it("accepts a canonical upload without rebinding its palette or changing its identity", () => {
  const source = previewPatternImport(legacyPattern(), { patternId: "existing", paletteMode: "source" }).pattern;
  expect(previewPatternImport(source, { patternId: "ignored", paletteMode: "mard221" }).pattern).toEqual(source);
});
it("verifies conversion on the server, archives the exact legacy JSON and rejects tampered matrices", async () => {
  const store = new PatternStore(":memory:"), app = await buildApp({ store, seed: false });
  try {
    const rawJson = JSON.stringify(legacyPattern(), null, 4);
    const { pattern } = previewPatternImport(rawJson, { patternId: "verified", paletteMode: "mard221" });
    const importOptions = { format: "legacy-grid-v1", paletteMode: "mard221" };
    const response = await app.inject({ method: "POST", url: "/api/v1/patterns", payload: { pattern, rawJson, importOptions } });
    expect(response.statusCode).toBe(201);
    const archive = response.json().archives[0];
    expect((await app.inject(`/api/v1/patterns/verified/archives/${archive.id}`)).body).toBe(rawJson);
    expect(store.history("verified")[0].details).toMatchObject({ migration: { paletteMode: "mard221", paletteConflicts: expect.any(Array) } });
    const tampered = structuredClone(pattern); tampered.patternId = "tampered"; tampered.grid.cells[0][0] = "H7";
    const rejected = await app.inject({ method: "POST", url: "/api/v1/patterns", payload: { pattern: tampered, rawJson, importOptions } });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("ORIGINAL_JSON_MISMATCH");
    expect(store.list()).toHaveLength(1);
    for (const invalid of [undefined, { format: "legacy-grid-v1", paletteMode: "random" }]) {
      const res = await app.inject({ method: "POST", url: "/api/v1/patterns", payload: { pattern, rawJson, importOptions: invalid } });
      expect(res.statusCode).toBe(422);
    }
  } finally { await app.close(); store.close(); }
});
