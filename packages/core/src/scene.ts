import { calculateStats, validateRect, DomainError } from "./index";
import type { BeadPattern, Rect } from "./types";
export type VectorElement =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      bead?: { x: number; y: number; code: string; id: string };
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
    }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      color: string;
      align?: "center" | "left";
    };
export interface VectorScene {
  width: number;
  height: number;
  elements: VectorElement[];
  revision: number;
  rect: Rect;
}
export function fullRect(p: BeadPattern): Rect {
  return { x1: 1, y1: 1, x2: p.grid.width, y2: p.grid.height };
}
export function createScene(
  p: BeadPattern,
  rect = fullRect(p),
  legend = true,
): VectorScene {
  validateRect(p, rect);
  const s = p.layout.cellSizeMm,
    ox = 8,
    oy = 24;
  const gw = (rect.x2 - rect.x1 + 1) * s,
    gh = (rect.y2 - rect.y1 + 1) * s;
  const width = Math.max(80, gw + 16),
    elements: VectorElement[] = [];
  const text = (
    x: number,
    y: number,
    value: string,
    size = 2.5,
    color = "#40515E",
    align: "left" | "center" = "left",
  ) => {
    const estimatedWidth = [...value].reduce(
      (sum, c) => sum + (/[\x20-\x7E]/.test(c) ? 0.6 : 1) * size,
      0,
    );
    const fitted =
      align === "left"
        ? Math.min(size, (size * (width - x - 2)) / Math.max(estimatedWidth, 1))
        : size;
    elements.push({
      kind: "text",
      x,
      y,
      text: value,
      size: fitted,
      color,
      align,
    });
  };
  text(ox, 5, p.title, 4.5, "#172B35");
  text(
    ox,
    11,
    `v${p.revision}  |  ${p.grid.width} x ${p.grid.height}  |  ${s} mm/cell`,
    2.5,
  );
  text(
    ox,
    16,
    `X ${rect.x1}-${rect.x2}   Y ${rect.y1}-${rect.y2}   ${p.palette.id} / ${p.palette.version}`,
    2,
  );
  for (let y = rect.y1; y <= rect.y2; y++)
    for (let x = rect.x1; x <= rect.x2; x++) {
      const code = p.grid.cells[y - 1][x - 1];
      if (code === null) continue;
      const fill = p.palette.colors[code].hex;
      elements.push({
        kind: "rect",
        x: ox + (x - rect.x1) * s,
        y: oy + (y - rect.y1) * s,
        width: s,
        height: s,
        fill,
        bead: { x, y, code, id: `bead-${x}-${y}` },
      });
      if (p.layout.showColorCodes) {
        const [r, g, b] = [1, 3, 5].map((i) =>
          parseInt(fill.slice(i, i + 2), 16),
        );
        text(
          ox + (x - rect.x1 + 0.5) * s,
          oy + (y - rect.y1 + 0.5) * s,
          code,
          Math.min(1.7, (s / Math.max(3, code.length)) * 1.5),
          r * 0.299 + g * 0.587 + b * 0.114 > 155 ? "#273341" : "#FFFFFF",
          "center",
        );
      }
    }
  if (p.layout.gridLines.show) {
    const color = p.layout.gridLines.color ?? "#B7C0CB",
      lw = p.layout.gridLines.widthMm ?? 0.08;
    for (let i = 0; i <= rect.x2 - rect.x1 + 1; i++)
      elements.push({
        kind: "line",
        x1: ox + i * s,
        y1: oy,
        x2: ox + i * s,
        y2: oy + gh,
        color,
        width: lw,
      });
    for (let i = 0; i <= rect.y2 - rect.y1 + 1; i++)
      elements.push({
        kind: "line",
        x1: ox,
        y1: oy + i * s,
        x2: ox + gw,
        y2: oy + i * s,
        color,
        width: lw,
      });
  }
  if (p.layout.coordinates.show) {
    for (let x = rect.x1; x <= rect.x2; x++)
      if (
        x === rect.x1 ||
        x === rect.x2 ||
        x % p.layout.coordinates.intervalX === 0
      )
        text(
          ox + (x - rect.x1 + 0.5) * s,
          oy - 3,
          String(x),
          Math.min(2.4, s * 0.65),
          "#52606D",
          "center",
        );
    for (let y = rect.y1; y <= rect.y2; y++)
      if (
        y === rect.y1 ||
        y === rect.y2 ||
        y % p.layout.coordinates.intervalY === 0
      )
        text(
          ox - 4,
          oy + (y - rect.y1 + 0.5) * s,
          String(y),
          Math.min(2.4, s * 0.65),
          "#52606D",
          "center",
        );
  }
  if (p.layout.board.show !== false) {
    const b = p.layout.board;
    for (let x = b.width; x < p.grid.width; x += b.width)
      if (x >= rect.x1 - 1 && x <= rect.x2)
        elements.push({
          kind: "line",
          x1: ox + (x - rect.x1 + 1) * s,
          y1: oy,
          x2: ox + (x - rect.x1 + 1) * s,
          y2: oy + gh,
          color: "#669687",
          width: 0.4,
        });
    for (let y = b.height; y < p.grid.height; y += b.height)
      if (y >= rect.y1 - 1 && y <= rect.y2)
        elements.push({
          kind: "line",
          x1: ox,
          y1: oy + (y - rect.y1 + 1) * s,
          x2: ox + gw,
          y2: oy + (y - rect.y1 + 1) * s,
          color: "#669687",
          width: 0.4,
        });
  }
  if (p.layout.board.showLabels === true) {
    const b = p.layout.board;
    for (let y = rect.y1; y <= rect.y2; y++)
      for (let x = rect.x1; x <= rect.x2; x++)
        if ((x - 1) % b.width === 0 && (y - 1) % b.height === 0)
          text(
            ox + (x - rect.x1) * s + 1,
            oy + (y - rect.y1) * s + 1.8,
            `B${Math.floor((y - 1) / b.height) + 1}-${Math.floor((x - 1) / b.width) + 1}`,
            Math.min(2, s * 0.4),
            "#497667",
          );
  }
  let height = oy + gh + 8;
  if (legend) {
    const stats = calculateStats(p, rect);
    text(
      ox,
      height + 2,
      `Materials  |  ${stats.beadCount} beads  |  ${stats.emptyCount} empty  |  ${stats.colorCount} colors`,
      2.5,
    );
    const columns = Math.max(1, Math.floor((width - 16) / 48));
    stats.colors.forEach((c, i) => {
      const xx = ox + ((i % columns) * (width - 16)) / columns,
        yy = height + 10 + Math.floor(i / columns) * 7;
      elements.push({
        kind: "rect",
        x: xx,
        y: yy - 1.7,
        width: 3.5,
        height: 3.5,
        fill: c.hex,
      });
      text(
        xx + 5,
        yy,
        `${c.code}  ${c.count}  (${c.percentage.toFixed(1)}%)`,
        2.2,
      );
    });
    height += 17 + Math.ceil(stats.colors.length / columns) * 7;
  }
  return { width, height, elements, revision: p.revision, rect };
}
export function paperDimensions(p: BeadPattern): [number, number] {
  const paper = p.layout.paper;
  let [w, h] =
    paper.size === "A4"
      ? [210, 297]
      : paper.size === "A3"
        ? [297, 420]
        : [paper.widthMm!, paper.heightMm!];
  if (
    (paper.orientation === "landscape" && w < h) ||
    (paper.orientation === "portrait" && w > h)
  )
    [w, h] = [h, w];
  return [w, h];
}
export function paginatePattern(p: BeadPattern, range = fullRect(p)): Rect[] {
  validateRect(p, range);
  const [pw, ph] = paperDimensions(p),
    margin = p.layout.paper.marginMm,
    s = p.layout.cellSizeMm;
  const maxX = Math.floor((pw - margin * 2 - 16) / s),
    maxY = Math.floor((ph - margin * 2 - 36) / s);
  if (maxX < 1 || maxY < 1)
    throw new DomainError(
      "PAPER_TOO_SMALL",
      "纸张可打印区域不足",
      422,
      "/layout/paper",
    );
  const pages: Rect[] = [];
  const tile = (r: Rect) => {
    for (let y = r.y1; y <= r.y2; y += maxY)
      for (let x = r.x1; x <= r.x2; x += maxX)
        pages.push({
          x1: x,
          y1: y,
          x2: Math.min(r.x2, x + maxX - 1),
          y2: Math.min(r.y2, y + maxY - 1),
        });
  };
  if (p.layout.paper.pagination === "board") {
    const b = p.layout.board;
    for (let y = 1; y <= p.grid.height; y += b.height)
      for (let x = 1; x <= p.grid.width; x += b.width) {
        const r = {
          x1: Math.max(range.x1, x),
          y1: Math.max(range.y1, y),
          x2: Math.min(range.x2, x + b.width - 1),
          y2: Math.min(range.y2, y + b.height - 1),
        };
        if (r.x1 <= r.x2 && r.y1 <= r.y2) tile(r);
      }
  } else tile(range);
  if (pages.length > 400)
    throw new DomainError(
      "EXPORT_PAGE_LIMIT",
      "导出超过 400 页，请调整单格尺寸、拼板或纸张",
      413,
    );
  return pages;
}
export function escapeXml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
export function renderSvg(
  p: BeadPattern,
  digest = "",
  range = fullRect(p),
  mode: "layout" | "plain" | "grid" | "coordinates" | "boards" = "layout",
): string {
  const copy = structuredClone(p);
  if (mode !== "layout") {
    copy.layout.gridLines.show = ["grid", "coordinates", "boards"].includes(
      mode,
    );
    copy.layout.coordinates.show = ["coordinates", "boards"].includes(mode);
    copy.layout.board.show = mode === "boards";
    copy.layout.board.showLabels =
      mode === "boards" && (p.layout.board.showLabels ?? false);
    copy.layout.showColorCodes = false;
  }
  const scene = createScene(copy, range);
  const content = scene.elements
    .map((e) =>
      e.kind === "rect"
        ? `<rect ${e.bead ? `id="${e.bead.id}" data-x="${e.bead.x}" data-y="${e.bead.y}" data-color="${escapeXml(e.bead.code)}" ` : ""}x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${e.fill}"/>`
        : e.kind === "line"
          ? `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.color}" stroke-width="${e.width}"/>`
          : `<text x="${e.x}" y="${e.y}" font-size="${e.size}" fill="${e.color}" text-anchor="${e.align === "center" ? "middle" : "start"}" dominant-baseline="middle">${escapeXml(e.text)}</text>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}mm" height="${scene.height}mm" viewBox="0 0 ${scene.width} ${scene.height}" data-revision="${p.revision}" shape-rendering="crispEdges"><title>${escapeXml(p.title)} v${p.revision}</title><metadata>${escapeXml(JSON.stringify({ schemaVersion: p.schemaVersion, patternId: p.patternId, revision: p.revision, digest, range, mode }))}</metadata><g font-family="Arial, Noto Sans CJK SC, sans-serif">${content}</g></svg>`;
}
