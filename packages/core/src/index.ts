import Ajv, { type ErrorObject } from "ajv";
import schema from "../../../docs/json-schema/bead-pattern-v1.schema.json";
import type {
  BeadPattern,
  Cell,
  CellDiff,
  EditPreview,
  EditRequest,
  Operation,
  PatternStats,
  Rect,
} from "./types";
export * from "./types";
export { schema as patternSchema };

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public path = "",
    public details?: unknown,
  ) {
    super(message);
  }
}
const validator = new Ajv({
  allErrors: true,
  strict: true,
}).compile<BeadPattern>(schema);
export function validatePattern(value: unknown): asserts value is BeadPattern {
  if (!validator(value)) {
    const issues = validator
      .errors!.slice(0, 100)
      .map((e: ErrorObject) => ({
        path:
          e.instancePath +
          (e.keyword === "required" ? "/" + e.params.missingProperty : ""),
        reason: e.message,
      }));
    throw new DomainError(
      "INVALID_PATTERN",
      "图纸结构不符合 BeadPattern v1",
      422,
      issues[0].path,
      issues,
    );
  }
  const p = value as BeadPattern;
  if (p.grid.cells.length !== p.grid.height)
    throw new DomainError(
      "GRID_HEIGHT_MISMATCH",
      "矩阵行数与 height 不一致",
      422,
      "/grid/cells",
    );
  p.grid.cells.forEach((row, y) => {
    if (row.length !== p.grid.width)
      throw new DomainError(
        "GRID_WIDTH_MISMATCH",
        `第 ${y + 1} 行长度与 width 不一致`,
        422,
        `/grid/cells/${y}`,
      );
    row.forEach((code, x) => {
      if (code !== null && !Object.hasOwn(p.palette.colors, code))
        throw new DomainError(
          "UNKNOWN_COLOR",
          `色号 ${code} 不在当前色卡中`,
          422,
          `/grid/cells/${y}/${x}`,
        );
    });
  });
  const paper = p.layout.paper;
  const width =
    paper.size === "A4" ? 210 : paper.size === "A3" ? 297 : paper.widthMm!;
  const height =
    paper.size === "A4" ? 297 : paper.size === "A3" ? 420 : paper.heightMm!;
  if (Math.min(width, height) - paper.marginMm * 2 < p.layout.cellSizeMm + 34)
    throw new DomainError(
      "PAPER_TOO_SMALL",
      "纸张可打印区域不足，请减小边距或单格尺寸",
      422,
      "/layout/paper",
    );
}
// Explicit version boundary. Future versions register a tested migration here.
export function parsePattern(input: string | unknown): BeadPattern {
  let value: unknown;
  try {
    value = typeof input === "string" ? JSON.parse(input) : input;
  } catch (e) {
    throw new DomainError("INVALID_JSON", String(e), 422, "/");
  }
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion !== "1.0"
  )
    throw new DomainError(
      "UNSUPPORTED_SCHEMA_VERSION",
      "仅支持 schemaVersion 1.0；未执行自动迁移",
      422,
      "/schemaVersion",
    );
  validatePattern(value);
  return structuredClone(value);
}
export function validateRect(p: BeadPattern, r: Rect, path = "/rect") {
  if (
    !r ||
    !["x1", "y1", "x2", "y2"].every((k) =>
      Number.isInteger(r[k as keyof Rect]),
    ) ||
    r.x1 < 1 ||
    r.y1 < 1 ||
    r.x2 > p.grid.width ||
    r.y2 > p.grid.height ||
    r.x1 > r.x2 ||
    r.y1 > r.y2
  )
    throw new DomainError(
      "INVALID_COORDINATES",
      "坐标越界或矩形范围无效，坐标从 1 开始",
      422,
      path,
    );
}
export function calculateStats(p: BeadPattern, range?: Rect): PatternStats {
  const { width, height, cells } = p.grid,
    b = p.layout.board;
  const bounds = range ?? { x1: 1, y1: 1, x2: width, y2: height };
  validateRect(p, bounds);
  const selectedCells = (bounds.x2 - bounds.x1 + 1) * (bounds.y2 - bounds.y1 + 1);
  const counts: Record<string, number> = Object.create(null);
  const boards = [];
  let beadCount = 0;
  for (let y1 = 1, by = 1; y1 <= height; y1 += b.height, by++) {
    for (let x1 = 1, bx = 1; x1 <= width; x1 += b.width, bx++) {
      const rect = {
        x1: Math.max(bounds.x1, x1),
        y1: Math.max(bounds.y1, y1),
        x2: Math.min(bounds.x2, x1 + b.width - 1),
        y2: Math.min(bounds.y2, y1 + b.height - 1),
      };
      if (rect.x1 > rect.x2 || rect.y1 > rect.y2) continue;
      const colors: Record<string, number> = Object.create(null);
      let beads = 0;
      for (let y = rect.y1; y <= rect.y2; y++)
        for (let x = rect.x1; x <= rect.x2; x++) {
          const code = cells[y - 1][x - 1];
          if (code !== null) {
            colors[code] = (colors[code] || 0) + 1;
            counts[code] = (counts[code] || 0) + 1;
            beads++;
          }
        }
      const totalCells = (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
      boards.push({
        id: `B${by}-${bx}`,
        rect,
        totalCells,
        beadCount: beads,
        emptyCount: totalCells - beads,
        colors,
      });
      beadCount += beads;
    }
  }
  return {
    revision: p.revision,
    totalCells: selectedCells,
    beadCount,
    emptyCount: selectedCells - beadCount,
    colorCount: Object.keys(counts).length,
    colors: Object.entries(counts)
      .map(([code, count]) => ({
        code,
        ...p.palette.colors[code],
        count,
        percentage: beadCount ? (count / beadCount) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    boards,
  };
}
export function diffPatterns(
  before: BeadPattern,
  after: BeadPattern,
): CellDiff[] {
  if (
    before.grid.width !== after.grid.width ||
    before.grid.height !== after.grid.height
  )
    throw new DomainError("GRID_MISMATCH", "图纸尺寸不一致，无法按格比较", 422);
  const result: CellDiff[] = [];
  before.grid.cells.forEach((row, y) =>
    row.forEach((code, x) => {
      const next = after.grid.cells[y][x];
      if (code !== next)
        result.push({ x: x + 1, y: y + 1, before: code, after: next });
    }),
  );
  return result;
}
function validateColor(
  p: BeadPattern,
  c: unknown,
  path: string,
): asserts c is Cell {
  if (
    c !== null &&
    (typeof c !== "string" || !Object.hasOwn(p.palette.colors, c))
  )
    throw new DomainError("UNKNOWN_COLOR", `未知色号 ${String(c)}`, 422, path);
}
const operationFields: Record<string, string[]> = {
  set_cell: ["type", "x", "y", "newColor", "expectedColor"],
  replace_color: ["type", "oldColor", "newColor"],
  replace_color_in_rect: ["type", "rect", "oldColor", "newColor"],
  fill_rect: ["type", "rect", "newColor", "nonEmptyOnly", "expectedColor"],
};
export function applyEdits(
  p: BeadPattern,
  request: EditRequest,
): { pattern: BeadPattern; preview: EditPreview } {
  if (!request || !Number.isInteger(request.baseRevision))
    throw new DomainError(
      "INVALID_EDIT",
      "缺少有效 baseRevision",
      422,
      "/baseRevision",
    );
  if (request.baseRevision !== p.revision)
    throw new DomainError(
      "REVISION_CONFLICT",
      `当前版本为 ${p.revision}，请重新获取并预览`,
      409,
      "/baseRevision",
      { currentRevision: p.revision },
    );
  if (
    !Array.isArray(request.operations) ||
    !request.operations.length ||
    request.operations.length > 1000
  )
    throw new DomainError(
      "INVALID_OPERATIONS",
      "每次提交需要 1–1000 个操作",
      422,
      "/operations",
    );
  if (
    request.idempotencyKey !== undefined &&
    (typeof request.idempotencyKey !== "string" ||
      request.idempotencyKey.length < 1 ||
      request.idempotencyKey.length > 100)
  )
    throw new DomainError(
      "INVALID_IDEMPOTENCY_KEY",
      "幂等键长度应为 1–100",
      422,
      "/idempotencyKey",
    );
  if (
    Object.keys(request).some(
      (k) => !["baseRevision", "operations", "idempotencyKey"].includes(k),
    )
  )
    throw new DomainError("INVALID_EDIT", "修改请求包含未知字段", 422);
  const next = structuredClone(p);
  let work = 0;
  request.operations.forEach((op: Operation, i) => {
    const path = `/operations/${i}`;
    if (
      !op ||
      !Object.hasOwn(operationFields, op.type) ||
      Object.keys(op).some((k) => !operationFields[op.type].includes(k))
    )
      throw new DomainError(
        "INVALID_OPERATION",
        "不支持的操作或字段",
        422,
        path,
      );
    validateColor(p, op.newColor, path + "/newColor");
    if ("oldColor" in op) validateColor(p, op.oldColor, path + "/oldColor");
    if ("expectedColor" in op)
      validateColor(p, op.expectedColor, path + "/expectedColor");
    if ("nonEmptyOnly" in op && typeof op.nonEmptyOnly !== "boolean")
      throw new DomainError(
        "INVALID_OPERATION",
        "nonEmptyOnly 应为布尔值",
        422,
        path,
      );
    const rect =
      op.type === "set_cell"
        ? { x1: op.x, x2: op.x, y1: op.y, y2: op.y }
        : op.type === "replace_color"
          ? { x1: 1, y1: 1, x2: p.grid.width, y2: p.grid.height }
          : op.rect;
    validateRect(p, rect, path + "/rect");
    work += (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
    if (work > 1000000)
      throw new DomainError(
        "OPERATION_LIMIT",
        "单次请求扫描格数不能超过 100 万",
        413,
        path,
      );
    for (let y = rect.y1; y <= rect.y2; y++)
      for (let x = rect.x1; x <= rect.x2; x++) {
        const before = next.grid.cells[y - 1][x - 1];
        if ("expectedColor" in op && before !== op.expectedColor)
          throw new DomainError(
            "EXPECTED_COLOR_MISMATCH",
            `坐标 (${x},${y}) 实际为 ${before ?? "空格"}，与预期不符`,
            409,
            path + "/expectedColor",
            { x, y, expected: op.expectedColor, actual: before },
          );
        if ("oldColor" in op && before !== op.oldColor) continue;
        if (op.type === "fill_rect" && op.nonEmptyOnly && before === null)
          continue;
        next.grid.cells[y - 1][x - 1] = op.newColor;
      }
  });
  const changes = diffPatterns(p, next);
  if (changes.length > 100000)
    throw new DomainError(
      "EDIT_LIMIT",
      "单次提交不能改变超过 100,000 格",
      413,
      "/operations",
    );
  const colorDeltas: Record<string, number> = Object.create(null);
  let beadDelta = 0;
  changes.forEach(({ before, after }) => {
    if (before !== null) {
      colorDeltas[before] = (colorDeltas[before] || 0) - 1;
      beadDelta--;
    }
    if (after !== null) {
      colorDeltas[after] = (colorDeltas[after] || 0) + 1;
      beadDelta++;
    }
  });
  return {
    pattern: next,
    preview: {
      baseRevision: p.revision,
      changedCells: changes.length,
      changes,
      colorDeltas,
      beadDelta,
      stats: calculateStats(next),
    },
  };
}
export function statsCsv(stats: PatternStats) {
  const escape = (s: unknown) => {
    const v = String(s);
    return (
      '"' + (/^[=+@\-\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""') + '"'
    );
  };
  return (
    "\uFEFF" +
    [
      ["revision", "code", "name", "hex", "count", "percentage"],
      ...stats.colors.map((c) => [
        stats.revision,
        c.code,
        c.name,
        c.hex,
        c.count,
        c.percentage.toFixed(4),
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
}
