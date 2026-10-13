import Ajv from "ajv";
import { DomainError, calculateStats, parsePattern, validatePattern } from "./index";
import { defaultLayout } from "./demo";
import mard from "../../../examples/palettes/mard221.json";
import type { BeadPattern, Cell } from "./types";

export type ImportPaletteMode = "mard221" | "source";
export interface LegacyImportOptions {
  format: "legacy-grid-v1";
  paletteMode: ImportPaletteMode;
}
export interface ImportPreview {
  pattern: BeadPattern;
  format: "beadpattern-v1" | "legacy-grid-v1";
  warnings: string[];
  paletteConflicts: { code: string; sourceHex: string; mardHex: string; count: number }[];
}
const legacyValidator = new Ajv({ allErrors: true }).compile({
  type: "object", additionalProperties: false,
  required: ["schema_version", "name", "width", "height", "palette_system", "orientation", "coordinate_system", "empty_cell", "palette", "grid"],
  properties: {
    schema_version: { const: 1 }, name: { type: "string", minLength: 1, maxLength: 200 },
    width: { type: "integer", minimum: 1, maximum: 500 }, height: { type: "integer", minimum: 1, maximum: 500 },
    palette_system: { enum: ["MARD 221", "MARD-221"] }, orientation: { const: "front" }, empty_cell: { type: "null" },
    coordinate_system: { type: "object", additionalProperties: false, required: ["origin", "index_base", "grid_access"], properties: {
      origin: { const: "top-left" }, index_base: { enum: [0, 1] }, grid_access: { const: "grid[y][x]" },
    } },
    color_count: { type: "integer", minimum: 0 }, total_beads: { type: "integer", minimum: 0 },
    palette: { type: "object", minProperties: 1, maxProperties: 221, propertyNames: { pattern: "^[a-zA-Z0-9_-]{1,32}$" }, additionalProperties: {
      type: "object", additionalProperties: false, required: ["hex"], properties: {
        hex: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, count: { type: "integer", minimum: 0 },
        rgb: { type: "array", minItems: 3, maxItems: 3, items: { type: "integer", minimum: 0, maximum: 255 } },
      },
    } },
    grid: { type: "array", minItems: 1, maxItems: 500, items: { type: "array", minItems: 1, maxItems: 500, items: { anyOf: [{ type: "null" }, { type: "string", pattern: "^[a-zA-Z0-9_-]{1,32}$" }] } } },
  },
});
interface LegacyPattern {
  schema_version: 1; name: string; width: number; height: number;
  coordinate_system: { index_base: 0 | 1 };
  total_beads?: number; color_count?: number;
  palette: Record<string, { hex: string; count?: number; rgb?: number[] }>;
  grid: Cell[][];
}

// Only the import boundary accepts this known producer format. Saved data and
// edit/export/MCP APIs continue to require the canonical BeadPattern schema.
export function previewPatternImport(input: string | unknown, options: { patternId: string; paletteMode?: ImportPaletteMode }): ImportPreview {
  let value: unknown;
  try { value = typeof input === "string" ? JSON.parse(input.replace(/^\uFEFF/, "")) : input; }
  catch { throw new DomainError("INVALID_JSON", "JSON 文件无法解析", 422, "/"); }
  if (!value || typeof value !== "object" || !("schema_version" in value)) {
    return { pattern: parsePattern(value), format: "beadpattern-v1", warnings: [], paletteConflicts: [] };
  }
  if (!legacyValidator(value)) {
    const issues = legacyValidator.errors!.map(e => ({ path: e.instancePath + (e.keyword === "required" ? "/" + e.params.missingProperty : ""), reason: e.message }));
    throw new DomainError("INVALID_LEGACY_PATTERN", "旧版图纸字段无效；仅支持正面、左上原点的 MARD 221 网格", 422, issues[0].path, issues);
  }
  const legacy = value as LegacyPattern;
  const canonicalColors = mard.colors as Record<string, { name: string; hex: string }>;
  const sourceColors: BeadPattern["palette"]["colors"] = Object.fromEntries(Object.entries(legacy.palette).map(([code, entry]) => {
    if (!Object.hasOwn(canonicalColors, code)) throw new DomainError("UNKNOWN_MARD_COLOR", `色号 ${code} 不在指定的 MARD 221 色卡中`, 422, `/palette/${code}`);
    return [code, { name: code, hex: entry.hex }];
  }));
  const pattern: BeadPattern = {
    schemaVersion: "1.0", patternId: options.patternId, revision: 1, title: legacy.name,
    source: { producer: "legacy-grid-v1 import" },
    grid: { width: legacy.width, height: legacy.height, origin: "top-left", coordinateBase: 1, cells: structuredClone(legacy.grid) },
    palette: { id: "MARD-221-source", version: "legacy-grid-v1", colors: sourceColors },
    layout: structuredClone(defaultLayout),
  };
  validatePattern(pattern); // Checks dimensions and source palette references before rebinding.
  const stats = calculateStats(pattern), counts = new Map(stats.colors.map(c => [c.code, c.count]));
  const warnings = [`已识别旧版 JSON；网格位置、色号和空格保持原样，界面坐标从 1 开始。`];
  if (legacy.total_beads !== undefined && legacy.total_beads !== stats.beadCount) warnings.push(`文件标记 ${legacy.total_beads} 颗，网格实际 ${stats.beadCount} 颗；统计以网格为准。`);
  if (legacy.color_count !== undefined && legacy.color_count !== stats.colorCount) warnings.push(`文件标记 ${legacy.color_count} 色，网格实际 ${stats.colorCount} 色。`);
  for (const [code, entry] of Object.entries(legacy.palette)) {
    if (entry.count !== undefined && entry.count !== (counts.get(code) ?? 0)) warnings.push(`${code} 的文件数量 ${entry.count} 与网格数量 ${counts.get(code) ?? 0} 不一致。`);
    if (entry.rgb && entry.rgb.some((n, i) => n !== parseInt(entry.hex.slice(1 + i * 2, 3 + i * 2), 16))) warnings.push(`${code} 的 RGB 与 HEX 不一致；原文件色值模式以 HEX 为准。`);
  }
  const paletteConflicts = Object.entries(sourceColors).filter(([code, entry]) => entry.hex.toUpperCase() !== canonicalColors[code].hex.toUpperCase()).map(([code, entry]) => ({ code, sourceHex: entry.hex, mardHex: canonicalColors[code].hex, count: counts.get(code) ?? 0 }));
  if (options.paletteMode === "mard221") pattern.palette = structuredClone(mard);
  validatePattern(pattern);
  return { pattern, format: "legacy-grid-v1", warnings, paletteConflicts };
}

export function validateImportOptions(value: unknown): asserts value is LegacyImportOptions {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["format", "paletteMode"].includes(k)) || !("format" in value) || value.format !== "legacy-grid-v1" || !("paletteMode" in value) || !["source", "mard221"].includes(String(value.paletteMode))) {
    throw new DomainError("INVALID_IMPORT_OPTIONS", "旧版导入需明确指定格式和色值模式", 422, "/importOptions");
  }
}
