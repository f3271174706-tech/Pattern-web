import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BeadPattern,
  Cell,
  Operation,
  Rect,
} from "../../../packages/core/src/types";
export type Tool =
  | "select"
  | "brush"
  | "eraser"
  | "eyedropper"
  | "rect"
  | "pan";
export interface Point {
  x: number;
  y: number;
}
interface Props {
  pattern: BeadPattern;
  tool: Tool;
  color: Cell;
  zoom: number;
  onZoom: (z: number) => void;
  selected: Point | null;
  onSelect: (p: Point) => void;
  onHover: (p: Point | null) => void;
  rect: Rect | null;
  onRect: (r: Rect | null) => void;
  onStroke: (ops: Operation[]) => Promise<void>;
  onPick: (c: Cell) => void;
  fitNonce: number;
  focusNonce: number;
  busy: boolean;
  highlight: string | null;
}
const BASE = 16,
  GUTTER = 34;
export function PatternCanvas(props: Props) {
  const { pattern: p, tool, zoom, selected, rect, busy } = props;
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    [size, setSize] = useState({ w: 800, h: 600 });
  const [pan, setPan] = useState({ x: 0, y: 0 }),
    [draft, setDraft] = useState<Rect | null>(null),
    [hover, setHover] = useState<Point | null>(null);
  const gesture = useRef<{
    kind: "pan" | "rect" | "stroke";
    start: Point;
    anchor: Point;
    pan: { x: number; y: number };
    cells: Map<string, Operation>;
  } | null>(null);
  const [strokeNonce, setStrokeNonce] = useState(0);
  const [space, setSpace] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const fit = useCallback(() => {
    const w = host.current?.clientWidth ?? 800,
      h = host.current?.clientHeight ?? 600;
    const next = Math.min(
      3,
      Math.max(
        0.15,
        Math.min(
          (w - 100) / (p.grid.width * BASE),
          (h - 100) / (p.grid.height * BASE),
        ),
      ),
    );
    props.onZoom(next);
    setPan({
      x: (w - p.grid.width * BASE * next) / 2,
      y: (h - p.grid.height * BASE * next) / 2,
    });
  }, [p.patternId, p.grid.width, p.grid.height]);
  useEffect(() => {
    fit();
    setHover(null);
  }, [p.patternId, props.fitNonce, fit]);
  useEffect(() => {
    if (props.focusNonce && selected)
      setPan({
        x: size.w / 2 - (selected.x - 0.5) * BASE * zoom,
        y: size.h / 2 - (selected.y - 0.5) * BASE * zoom,
      });
  }, [props.focusNonce]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,select,textarea")) return;
      if (e.code === "Space") {
        setSpace(e.type === "keydown");
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    c.style.width = size.w + "px";
    c.style.height = size.h + "px";
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size.w, size.h);
    const cs = BASE * zoom,
      gw = p.grid.width * cs,
      gh = p.grid.height * cs;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pan.x, pan.y, gw, gh);
    ctx.clip();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(pan.x, pan.y, gw, gh);
    const minX = Math.max(0, Math.floor(-pan.x / cs)),
      minY = Math.max(0, Math.floor(-pan.y / cs)),
      maxX = Math.min(p.grid.width, Math.ceil((size.w - pan.x) / cs)),
      maxY = Math.min(p.grid.height, Math.ceil((size.h - pan.y) / cs));
    for (let y = minY; y < maxY; y++)
      for (let x = minX; x < maxX; x++) {
        const key = `${x + 1},${y + 1}`,
          op = gesture.current?.cells.get(key);
        let code = p.grid.cells[y][x];
        if (op?.type === "set_cell") code = op.newColor;
        const xx = pan.x + x * cs,
          yy = pan.y + y * cs;
        if (code !== null) {
          ctx.fillStyle = p.palette.colors[code].hex;
          ctx.globalAlpha =
            props.highlight && props.highlight !== code ? 0.15 : 1;
          ctx.fillRect(xx, yy, cs + 0.15, cs + 0.15);
          ctx.globalAlpha = 1;
        } else if (cs >= 5) {
          ctx.fillStyle = "#EDF0F2";
          const radius = Math.max(0.6, cs * 0.06);
          ctx.beginPath();
          ctx.arc(xx + cs / 2, yy + cs / 2, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.layout.showColorCodes && code && cs >= 12) {
          const hex = p.palette.colors[code].hex;
          const lum = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
          ctx.fillStyle =
            lum[0] * 0.299 + lum[1] * 0.587 + lum[2] * 0.114 > 155
              ? "#273341"
              : "#FFF";
          ctx.font = `${Math.min(10, (cs / Math.max(3, code.length)) * 1.4)}px ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(code, xx + cs / 2, yy + cs / 2);
        }
      }
    if (p.layout.gridLines.show && cs >= 3) {
      ctx.strokeStyle = p.layout.gridLines.color ?? "#C7CFD4";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      for (let x = minX; x <= maxX; x++) {
        const xx = pan.x + x * cs;
        ctx.moveTo(xx, pan.y + minY * cs);
        ctx.lineTo(xx, pan.y + maxY * cs);
      }
      for (let y = minY; y <= maxY; y++) {
        const yy = pan.y + y * cs;
        ctx.moveTo(pan.x + minX * cs, yy);
        ctx.lineTo(pan.x + maxX * cs, yy);
      }
      ctx.stroke();
    }
    if (p.layout.board.show !== false) {
      const b = p.layout.board;
      ctx.strokeStyle = "#67A38E";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let x = b.width; x < p.grid.width; x += b.width) {
        ctx.moveTo(pan.x + x * cs, pan.y);
        ctx.lineTo(pan.x + x * cs, pan.y + gh);
      }
      for (let y = b.height; y < p.grid.height; y += b.height) {
        ctx.moveTo(pan.x, pan.y + y * cs);
        ctx.lineTo(pan.x + gw, pan.y + y * cs);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.layout.board.showLabels === true) {
      const b = p.layout.board;
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (
        let y = Math.floor(minY / b.height) * b.height;
        y < maxY;
        y += b.height
      )
        for (
          let x = Math.floor(minX / b.width) * b.width;
          x < maxX;
          x += b.width
        ) {
          const xx = pan.x + x * cs + 5,
            yy = pan.y + y * cs + 5;
          const label = `B${Math.floor(y / b.height) + 1}-${Math.floor(x / b.width) + 1}`;
          ctx.fillStyle = "rgba(240,249,245,.91)";
          ctx.fillRect(xx - 3, yy - 2, ctx.measureText(label).width + 6, 14);
          ctx.fillStyle = "#4F8572";
          ctx.fillText(label, xx, yy);
        }
    }
    const selection = draft ?? rect;
    if (selection) {
      ctx.fillStyle = "rgba(75,117,213,.12)";
      ctx.strokeStyle = "#547BE5";
      ctx.lineWidth = 2;
      const xx = pan.x + (selection.x1 - 1) * cs,
        yy = pan.y + (selection.y1 - 1) * cs,
        ww = (selection.x2 - selection.x1 + 1) * cs,
        hh = (selection.y2 - selection.y1 + 1) * cs;
      ctx.fillRect(xx, yy, ww, hh);
      ctx.strokeRect(xx, yy, ww, hh);
    }
    if (selected) {
      ctx.strokeStyle = "#356DD7";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(
        pan.x + (selected.x - 1) * cs + 1,
        pan.y + (selected.y - 1) * cs + 1,
        cs - 2,
        cs - 2,
      );
    }
    if (hover && tool !== "pan" && !space) {
      ctx.strokeStyle = "#335FBD";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        pan.x + (hover.x - 1) * cs + 0.5,
        pan.y + (hover.y - 1) * cs + 0.5,
        cs - 1,
        cs - 1,
      );
    }
    ctx.restore();
    ctx.strokeStyle = "#B9C3CB";
    ctx.lineWidth = 1;
    ctx.strokeRect(pan.x, pan.y, gw, gh);
    if (p.layout.coordinates.show) {
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillStyle = "#84909C";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let x = minX + 1; x <= maxX; x++)
        if (
          x === 1 ||
          x === p.grid.width ||
          x % p.layout.coordinates.intervalX === 0
        )
          ctx.fillText(String(x), pan.x + (x - 0.5) * cs, pan.y - 13);
      for (let y = minY + 1; y <= maxY; y++)
        if (
          y === 1 ||
          y === p.grid.height ||
          y % p.layout.coordinates.intervalY === 0
        )
          ctx.fillText(String(y), pan.x - 16, pan.y + (y - 0.5) * cs);
    }
  }, [
    p,
    size,
    pan,
    zoom,
    selected,
    rect,
    draft,
    hover,
    tool,
    space,
    props.highlight,
    strokeNonce,
  ]);
  const pointer = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cell = (point: Point): Point | null => {
    const x = Math.floor((point.x - pan.x) / (BASE * zoom)) + 1,
      y = Math.floor((point.y - pan.y) / (BASE * zoom)) + 1;
    return x >= 1 && x <= p.grid.width && y >= 1 && y <= p.grid.height
      ? { x, y }
      : null;
  };
  const mark = (pt: Point) => {
    const g = gesture.current;
    if (!g) return;
    g.cells.set(`${pt.x},${pt.y}`, {
      type: "set_cell",
      x: pt.x,
      y: pt.y,
      expectedColor: p.grid.cells[pt.y - 1][pt.x - 1],
      newColor: tool === "eraser" ? null : props.color,
    });
    setStrokeNonce((n) => n + 1);
  };
  const down = (e: React.PointerEvent) => {
    if (busy || e.button > 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = pointer(e),
      coord = cell(pt);
    if (tool === "pan" || space || e.button === 1) {
      gesture.current = {
        kind: "pan",
        start: pt,
        anchor: pt,
        pan,
        cells: new Map(),
      };
      return;
    }
    if (!coord) return;
    props.onSelect(coord);
    if (tool === "select") {
      props.onRect(null);
      return;
    }
    if (tool === "eyedropper") {
      props.onPick(p.grid.cells[coord.y - 1][coord.x - 1]);
      return;
    }
    const kind = tool === "rect" ? "rect" : "stroke";
    gesture.current = { kind, start: pt, anchor: coord, pan, cells: new Map() };
    if (kind === "rect")
      setDraft({ x1: coord.x, y1: coord.y, x2: coord.x, y2: coord.y });
    else mark(coord);
  };
  const move = (e: React.PointerEvent) => {
    const pt = pointer(e),
      coord = cell(pt),
      g = gesture.current;
    setHover(coord);
    props.onHover(coord);
    if (!g) return;
    if (g.kind === "pan") {
      setPan({ x: g.pan.x + pt.x - g.start.x, y: g.pan.y + pt.y - g.start.y });
      return;
    }
    if (!coord) return;
    if (g.kind === "rect")
      setDraft({
        x1: Math.min(coord.x, g.anchor.x),
        y1: Math.min(coord.y, g.anchor.y),
        x2: Math.max(coord.x, g.anchor.x),
        y2: Math.max(coord.y, g.anchor.y),
      });
    else {
      const from = g.anchor,
        steps = Math.max(
          Math.abs(coord.x - from.x),
          Math.abs(coord.y - from.y),
        );
      for (let i = 0; i <= steps; i++)
        mark({
          x: Math.round(from.x + ((coord.x - from.x) * i) / (steps || 1)),
          y: Math.round(from.y + ((coord.y - from.y) * i) / (steps || 1)),
        });
      g.anchor = coord;
    }
  };
  const up = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "rect") {
      props.onRect(draft);
      setDraft(null);
    }
    if (g.kind === "stroke") {
      setStrokeNonce((n) => n + 1);
      void props.onStroke([...g.cells.values()]);
    }
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top,
        next = Math.max(0.1, Math.min(8, zoom * Math.exp(-e.deltaY * 0.0015)));
      setPan({
        x: x - ((x - pan.x) * next) / zoom,
        y: y - ((y - pan.y) * next) / zoom,
      });
      props.onZoom(next);
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, [zoom, pan]);
  return (
    <div className="canvas-host" ref={host}>
      <canvas
        ref={canvas}
        aria-label="拼豆图纸画布"
        data-testid="pattern-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          gesture.current = null;
          setDraft(null);
          setStrokeNonce((n) => n + 1);
        }}
        onPointerLeave={() => {
          if (!gesture.current) {
            setHover(null);
            props.onHover(null);
          }
        }}
        style={{
          cursor:
            space || tool === "pan"
              ? "grab"
              : tool === "brush" || tool === "eraser"
                ? "crosshair"
                : tool === "eyedropper"
                  ? "copy"
                  : "default",
        }}
      />
      {hover && (
        <div
          className="canvas-tooltip"
          style={{
            left: Math.min(
              size.w - 155,
              Math.max(8, pan.x + hover.x * BASE * zoom + 12),
            ),
            top: Math.min(
              size.h - 40,
              Math.max(8, pan.y + hover.y * BASE * zoom + 12),
            ),
          }}
        >
          X {hover.x} · Y {hover.y}
          <span>{p.grid.cells[hover.y - 1][hover.x - 1] ?? "空格"}</span>
        </div>
      )}
    </div>
  );
}
