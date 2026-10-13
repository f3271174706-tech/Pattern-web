import type { BeadPattern } from "./types";
export const defaultLayout: BeadPattern["layout"] = {
  cellSizeMm: 5,
  board: { width: 29, height: 29, show: true, showLabels: false },
  coordinates: { show: true, intervalX: 5, intervalY: 5 },
  gridLines: { show: true, color: "#B7C0CB", widthMm: 0.08 },
  showColorCodes: false,
  paper: {
    size: "A4",
    orientation: "portrait",
    marginMm: 10,
    pagination: "board",
  },
};
export function createDemo(): BeadPattern {
  const colors = {
    D01: { name: "墨黑", hex: "#283A3C" },
    D02: { name: "森林绿", hex: "#4B8265" },
    D03: { name: "嫩叶绿", hex: "#8DB578" },
    D04: { name: "浅奶油", hex: "#F2E5B9" },
    D05: { name: "陶土棕", hex: "#B97857" },
    D06: { name: "暖白", hex: "#FFFFFF" },
    D07: { name: "浅陶土", hex: "#D79F73" },
    D08: { name: "花瓣粉", hex: "#E7A99F" },
  };
  const p: BeadPattern = {
    schemaVersion: "1.0",
    patternId: "demo-garden",
    revision: 1,
    title: "窗台小花园",
    source: { producer: "Workbench hand-authored example" },
    grid: {
      width: 58,
      height: 58,
      origin: "top-left",
      coordinateBase: 1,
      cells: Array.from({ length: 58 }, () => Array(58).fill(null)),
    },
    palette: { id: "demo-custom", version: "v1", colors },
    layout: structuredClone(defaultLayout),
  };
  const paint = (x: number, y: number, c: string) => {
    if (x >= 0 && x < 58 && y >= 0 && y < 58) p.grid.cells[y][x] = c;
  };
  const box = (x: number, y: number, w: number, h: number, c: string) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) paint(xx, yy, c);
  };
  const ellipse = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: string,
  ) => {
    for (let y = 0; y < 58; y++)
      for (let x = 0; x < 58; x++)
        if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1)
          paint(x, y, c);
  };
  // Hand-authored cells: decorative example only, no image conversion or brand palette claim.
  box(6, 47, 47, 2, "D01");
  box(8, 49, 43, 2, "D07");
  box(14, 13, 2, 26, "D01");
  box(25, 8, 2, 31, "D01");
  box(38, 17, 2, 22, "D01");
  ellipse(11, 22, 5, 7, "D01");
  ellipse(11, 22, 3.6, 5.5, "D02");
  box(9, 19, 2, 6, "D03");
  ellipse(19, 15, 6, 5, "D01");
  ellipse(19, 15, 4.7, 3.6, "D03");
  box(17, 14, 5, 1, "D02");
  ellipse(22, 29, 5, 6, "D01");
  ellipse(22, 29, 3.6, 4.7, "D02");
  ellipse(29, 21, 5, 8, "D01");
  ellipse(29, 21, 3.6, 6.4, "D03");
  box(28, 18, 1, 8, "D02");
  ellipse(32, 10, 6, 4, "D01");
  ellipse(32, 10, 4.5, 2.6, "D02");
  ellipse(38, 18, 5, 5, "D08");
  ellipse(38, 18, 2, 2, "D04");
  ellipse(44, 29, 6, 6, "D01");
  ellipse(44, 29, 4.7, 4.7, "D03");
  box(43, 26, 1, 7, "D02");
  ellipse(36, 31, 5, 4, "D01");
  ellipse(36, 31, 3.7, 2.7, "D02");
  box(9, 36, 39, 4, "D01");
  box(11, 37, 35, 2, "D04");
  for (let y = 40; y <= 46; y++) {
    const inset = Math.floor((y - 40) / 2);
    box(12 + inset, y, 33 - 2 * inset, 1, "D01");
    box(14 + inset, y, 29 - 2 * inset, 1, "D05");
    box(15 + inset, y, 4, 1, "D07");
  }
  paint(13, 7, "D04");
  paint(12, 8, "D04");
  paint(14, 8, "D04");
  paint(13, 9, "D04");
  paint(47, 13, "D04");
  paint(46, 14, "D04");
  paint(48, 14, "D04");
  paint(47, 15, "D04");
  box(31, 41, 2, 2, "D06");
  box(36, 41, 2, 2, "D06");
  box(33, 44, 3, 1, "D01");
  return p;
}
export function createSmallDemo(): BeadPattern {
  return {
    schemaVersion: "1.0",
    patternId: "demo-001",
    revision: 1,
    title: "3×2 验收示例",
    source: { producer: "ChatGPT Work" },
    grid: {
      width: 3,
      height: 2,
      origin: "top-left",
      coordinateBase: 1,
      cells: [
        ["C01", "C01", null],
        ["C02", "C01", "C02"],
      ],
    },
    palette: {
      id: "custom",
      version: "v1",
      colors: {
        C01: { name: "示例颜色1", hex: "#D9A066" },
        C02: { name: "示例颜色2", hex: "#8B5544" },
        WHITE: { name: "白色", hex: "#FFFFFF" },
      },
    },
    layout: structuredClone(defaultLayout),
  };
}
