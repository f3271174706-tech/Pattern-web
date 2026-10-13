export type Cell = string | null;
export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Palette {
  id: string;
  version: string;
  colors: Record<string, { name: string; hex: string }>;
}
export interface Layout {
  cellSizeMm: number;
  board: {
    width: number;
    height: number;
    show?: boolean;
    showLabels?: boolean;
  };
  coordinates: { show: boolean; intervalX: number; intervalY: number };
  gridLines: { show: boolean; color?: string; widthMm?: number };
  showColorCodes?: boolean;
  paper: {
    size: "A4" | "A3" | "custom";
    orientation: "portrait" | "landscape";
    marginMm: number;
    widthMm?: number;
    heightMm?: number;
    pagination?: "auto" | "board";
  };
}
export interface BeadPattern {
  schemaVersion: "1.0";
  patternId: string;
  revision: number;
  title: string;
  source?: { producer?: string };
  grid: {
    width: number;
    height: number;
    origin: "top-left";
    coordinateBase: 1;
    cells: Cell[][];
  };
  palette: Palette;
  layout: Layout;
}
export type Operation =
  | {
      type: "set_cell";
      x: number;
      y: number;
      newColor: Cell;
      expectedColor?: Cell;
    }
  | { type: "replace_color"; oldColor: Cell; newColor: Cell }
  | {
      type: "replace_color_in_rect";
      rect: Rect;
      oldColor: Cell;
      newColor: Cell;
    }
  | {
      type: "fill_rect";
      rect: Rect;
      newColor: Cell;
      nonEmptyOnly?: boolean;
      expectedColor?: Cell;
    };
export interface EditRequest {
  baseRevision: number;
  operations: Operation[];
  idempotencyKey?: string;
}
export interface CellDiff {
  x: number;
  y: number;
  before: Cell;
  after: Cell;
}
export interface ColorCount {
  code: string;
  name: string;
  hex: string;
  count: number;
  percentage: number;
}
export interface BoardStats {
  id: string;
  rect: Rect;
  totalCells: number;
  beadCount: number;
  emptyCount: number;
  colors: Record<string, number>;
}
export interface PatternStats {
  revision: number;
  totalCells: number;
  beadCount: number;
  emptyCount: number;
  colorCount: number;
  colors: ColorCount[];
  boards: BoardStats[];
}
export interface EditPreview {
  baseRevision: number;
  changedCells: number;
  changes: CellDiff[];
  colorDeltas: Record<string, number>;
  beadDelta: number;
  stats: PatternStats;
}
export interface RevisionSummary {
  revision: number;
  type: string;
  createdAt: string;
  changedCells: number;
  digest: string;
  details: unknown;
}
