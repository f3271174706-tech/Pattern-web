import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Code2,
  Crosshair,
  Download,
  Ellipsis,
  Expand,
  FileJson,
  FileText,
  FolderOpen,
  Grid2X2,
  Hand,
  History,
  Info,
  Layers,
  Maximize,
  Minus,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pencil,
  Pipette,
  Plus,
  Redo2,
  Search,
  Settings2,
  ShieldCheck,
  SquareDashed,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  Eraser,
  Palette as PaletteIcon,
} from "lucide-react";
import type {
  BeadPattern,
  Cell,
  CellDiff,
  EditPreview,
  EditRequest,
  Layout,
  Operation,
  Palette,
  PatternStats,
  Rect,
  RevisionSummary,
} from "../../../packages/core/src/types";
import {
  calculateStats,
  DomainError,
  parsePattern,
} from "../../../packages/core/src/index";
import { defaultLayout } from "../../../packages/core/src/demo";
import {
  previewPatternImport,
  type ImportPaletteMode,
  type ImportPreview,
} from "../../../packages/core/src/import-pattern";
import {
  api,
  ApiError,
  download,
  type PatternState,
  type Project,
} from "./api";
import { PatternCanvas, type Point, type Tool } from "./PatternCanvas";

const number = (n: number) => n.toLocaleString("zh-CN");
type Dialog =
  | "import"
  | "new"
  | "history"
  | "batch"
  | "export"
  | "archives"
  | "delete"
  | "palette"
  | "shortcuts"
  | null;
const operationLabels: Record<string, string> = {
  import: "导入图纸",
  edit: "修改珠子",
  layout: "调整排版",
  palette: "绑定色卡",
  restore: "恢复历史",
  undo: "撤销操作",
  redo: "重做操作",
};
const tools: { id: Tool; label: string; key: string; icon: typeof Pencil }[] = [
  { id: "select", label: "选择", key: "V", icon: MousePointer2 },
  { id: "brush", label: "画笔", key: "B", icon: Pencil },
  { id: "eraser", label: "橡皮擦", key: "E", icon: Eraser },
  { id: "eyedropper", label: "吸管", key: "I", icon: Pipette },
  { id: "rect", label: "矩形选区", key: "R", icon: SquareDashed },
  { id: "pan", label: "平移", key: "H", icon: Hand },
];
function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={"icon-button" + (active ? " active" : "")}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
    </button>
  );
}
function Swatch({ hex, small = false }: { hex: string; small?: boolean }) {
  return (
    <span
      className={"swatch" + (small ? " small" : "")}
      style={{ background: hex }}
    />
  );
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle-label">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" />
    </label>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const focusable = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select,textarea,a[href]",
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          end = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      last?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal" + (wide ? " wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton icon={X} label="关闭" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<"loading" | "login" | "ready">("loading"),
    [loginToken, setLoginToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]),
    [presets, setPresets] = useState<
      {
        palette: Palette;
        source: { sourceFile: string; colorCount: number; sha256: string };
      }[]
    >([]);
  const [state, setState] = useState<PatternState | null>(null),
    [busy, setBusy] = useState(false),
    busyRef = useRef(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState<Dialog>(null);
  const [projectSearch, setProjectSearch] = useState(""),
    [tab, setTab] = useState<"pattern" | "materials" | "layout">("pattern");
  const [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState<Cell>(null),
    [hover, setHover] = useState<Point | null>(null),
    [selected, setSelected] = useState<Point | null>(null),
    [rect, setRect] = useState<Rect | null>(null);
  const [zoom, setZoom] = useState(1),
    [fitNonce, setFitNonce] = useState(0),
    [focusNonce, setFocusNonce] = useState(0);
  const [colorSearch, setColorSearch] = useState(""),
    [statsSearch, setStatsSearch] = useState(""),
    [sortAsc, setSortAsc] = useState(false),
    [boardFilter, setBoardFilter] = useState(""),
    [highlight, setHighlight] = useState<string | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<Layout | null>(null);
  const [preview, setPreview] = useState<{
      request: EditRequest;
      result: EditPreview;
    } | null>(null),
    [batchMode, setBatchMode] = useState<"replace" | "fill" | "clear">(
      "replace",
    ),
    [batchOld, setBatchOld] = useState<Cell>(null),
    [batchNew, setBatchNew] = useState<Cell>(null),
    [batchScope, setBatchScope] = useState<"global" | "rect">("global"),
    [batchNonempty, setBatchNonempty] = useState(true),
    [batchRect, setBatchRect] = useState<Rect>({ x1: 1, y1: 1, x2: 1, y2: 1 });
  const [jsonFile, setJsonFile] = useState<File | null>(null),
    [originalFiles, setOriginalFiles] = useState<File[]>([]),
    [importInfo, setImportInfo] = useState<BeadPattern | null>(null);
  const [importDetails, setImportDetails] = useState<ImportPreview | null>(
      null,
    ),
    [importPaletteMode, setImportPaletteMode] =
      useState<ImportPaletteMode>("mard221");
  const importSelection = useRef(0);
  const [newTitle, setNewTitle] = useState("未命名图纸"),
    [newWidth, setNewWidth] = useState(58),
    [newHeight, setNewHeight] = useState(58),
    [newPreset, setNewPreset] = useState("MARD-221");
  const [history, setHistory] = useState<RevisionSummary[]>([]),
    [diffFrom, setDiffFrom] = useState(1),
    [diffTo, setDiffTo] = useState(1),
    [differences, setDifferences] = useState<CellDiff[] | null>(null),
    [restoreTarget, setRestoreTarget] = useState<number | null>(null);
  const [exportFormat, setExportFormat] = useState<"svg" | "pdf">("svg"),
    [exportRevision, setExportRevision] = useState(1),
    [exportMode, setExportMode] = useState("layout"),
    [exportScope, setExportScope] = useState<"full" | "rect">("full");
  const [paletteInput, setPaletteInput] = useState<Palette | null>(null);
  const p = state?.pattern,
    stats = useMemo(() => (p ? calculateStats(p) : null), [p]);
  const path = p ? `/patterns/${p.patternId}` : "";
  const notify = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((n) => (n === message ? "" : n)), 4500);
  };
  const fail = (e: unknown) => {
    const ex = e as Error & { path?: string; status?: number };
    setError(`${ex.message}${ex.path ? " · " + ex.path : ""}`);
    if (ex.status === 401) setAuth("login");
  };
  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      fail(e);
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT" && p) {
        setPreview(null);
        const latest = await api<PatternState>(path).catch(() => null);
        if (latest) applyState(latest);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const refreshProjects = async () =>
    setProjects(await api<Project[]>("/patterns"));
  const applyState = (next: PatternState) => {
    setState(next);
    setLayoutDraft(structuredClone(next.pattern.layout));
    setColor((prev) =>
      prev === null || Object.hasOwn(next.pattern.palette.colors, prev)
        ? prev
        : Object.keys(next.pattern.palette.colors)[0],
    );
  };
  const openProject = async (id: string) => {
    const next = await api<PatternState>(`/patterns/${id}`);
    applyState(next);
    setColor(Object.keys(next.pattern.palette.colors)[0]);
    setSelected(null);
    setRect(null);
    setBoardFilter("");
    setHighlight(null);
    setColorSearch("");
    setTool("select");
    localStorage.setItem("bead-last-project", id);
  };
  const load = async () => {
    const [list, palette] = await Promise.all([
      api<Project[]>("/patterns"),
      api<typeof presets>("/palettes"),
    ]);
    setProjects(list);
    setPresets(palette);
    const saved = localStorage.getItem("bead-last-project");
    if (list.length)
      await openProject(list.find((v) => v.id === saved)?.id ?? list[0].id);
  };
  useEffect(() => {
    void api<{ authRequired: boolean; mode: string }>("/config")
      .then(async (config) => {
        if (config.authRequired) {
          try {
            await load();
            setAuth("ready");
          } catch (e) {
            if ((e as ApiError).status === 401) setAuth("login");
            else fail(e);
          }
        } else {
          await load();
          setAuth("ready");
        }
      })
      .catch((e) => {
        setAuth("ready");
        fail(e);
      });
  }, []);
  useEffect(() => {
    setPreview(null);
    setRect(null);
  }, [p?.patternId]);
  const commit = async (request: EditRequest) => {
    const next = await api<PatternState>(path + "/edits/commit", "POST", {
      ...request,
      idempotencyKey: request.idempotencyKey ?? crypto.randomUUID(),
    });
    applyState(next);
    setPreview(null);
    setDialog(null);
    await refreshProjects();
    notify(`已保存为 v${next.pattern.revision}`);
  };
  const prepare = async (operations: Operation[]) => {
    if (!p) return;
    const request = {
      baseRevision: p.revision,
      operations,
      idempotencyKey: crypto.randomUUID(),
    };
    const result = await api<EditPreview>(
      path + "/edits/preview",
      "POST",
      request,
    );
    setPreview({ request, result });
    if (!result.changedCells) notify("没有格子需要修改");
  };
  const stroke = async (ops: Operation[]) => {
    await run(async () => {
      if (!p) return;
      const changed = ops.filter(
        (op) => op.type === "set_cell" && op.newColor !== op.expectedColor,
      );
      if (!changed.length) return;
      if (changed.length === 1)
        await commit({ baseRevision: p.revision, operations: changed });
      else await prepare(changed);
    });
  };
  const travel = (action: "undo" | "redo") =>
    void run(async () => {
      if (!p) return;
      applyState(
        await api<PatternState>(path + "/" + action, "POST", {
          baseRevision: p.revision,
        }),
      );
      await refreshProjects();
      notify(action === "undo" ? "已撤销并保存新版本" : "已重做并保存新版本");
    });
  const openHistory = () =>
    void run(async () => {
      if (!p) return;
      setHistory(await api<RevisionSummary[]>(path + "/revisions"));
      setDiffFrom(1);
      setDiffTo(p.revision);
      setDifferences(null);
      setRestoreTarget(null);
      setDialog("history");
    });
  const openBatch = () => {
    if (!p) return;
    setBatchOld(
      selected ? p.grid.cells[selected.y - 1][selected.x - 1] : color,
    );
    setBatchNew(color);
    setBatchScope(rect ? "rect" : "global");
    setBatchRect(rect ?? { x1: 1, y1: 1, x2: p.grid.width, y2: p.grid.height });
    setBatchMode("replace");
    setPreview(null);
    setDialog("batch");
  };
  const batchPrepare = () =>
    void run(async () => {
      if (!p) return;
      const r =
        batchScope === "rect"
          ? batchRect
          : { x1: 1, y1: 1, x2: p.grid.width, y2: p.grid.height };
      const op: Operation =
        batchMode === "replace"
          ? batchScope === "global"
            ? { type: "replace_color", oldColor: batchOld, newColor: batchNew }
            : {
                type: "replace_color_in_rect",
                rect: r,
                oldColor: batchOld,
                newColor: batchNew,
              }
          : {
              type: "fill_rect",
              rect: r,
              newColor: batchMode === "clear" ? null : batchNew,
              nonEmptyOnly: batchMode === "fill" && batchNonempty,
            };
      await prepare([op]);
    });
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    const selection = ++importSelection.current;
    setJsonFile(null);
    setImportInfo(null);
    setImportDetails(null);
    if (file.size > 16 * 1024 * 1024) {
      setError("JSON 文件最大 16 MB");
      return;
    }
    try {
      const details = previewPatternImport(await file.text(), {
        patternId: crypto.randomUUID(),
        paletteMode: "mard221",
      });
      if (selection !== importSelection.current) return;
      setJsonFile(file);
      setImportInfo(details.pattern);
      setImportDetails(details);
      setImportPaletteMode("mard221");
      setError("");
    } catch (e) {
      if (selection !== importSelection.current) return;
      fail(e);
      setJsonFile(null);
      setImportInfo(null);
    }
  };
  const changeImportPalette = (mode: ImportPaletteMode) =>
    void run(async () => {
      if (!jsonFile || !importInfo) return;
      const details = previewPatternImport(await jsonFile.text(), {
        patternId: importInfo.patternId,
        paletteMode: mode,
      });
      setImportInfo(details.pattern);
      setImportDetails(details);
      setImportPaletteMode(mode);
    });
  const importPattern = () =>
    void run(async () => {
      if (!jsonFile || !importInfo) return;
      const rawJson = await jsonFile.text(),
        details = previewPatternImport(rawJson, {
          patternId: importInfo.patternId,
          paletteMode: importPaletteMode,
        }),
        pattern = details.pattern;
      const originals = await Promise.all(
        originalFiles.map(async (f) => {
          if (f.size > 8 * 1024 * 1024)
            throw new Error("每个 SVG/PDF 附件最大 8 MB");
          if (!/\.(svg|pdf)$/i.test(f.name))
            throw new Error("原始附件仅支持 SVG 和 PDF");
          const bytes = new Uint8Array(await f.arrayBuffer());
          let str = "";
          for (let i = 0; i < bytes.length; i += 8192)
            str += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return {
            name: f.name,
            format: f.name.toLowerCase().endsWith(".svg") ? "svg" : "pdf",
            base64: btoa(str),
          };
        }),
      );
      const result = await api<PatternState>("/patterns", "POST", {
        pattern,
        rawJson,
        originals,
        ...(details.format === "legacy-grid-v1"
          ? {
              importOptions: {
                format: details.format,
                paletteMode: importPaletteMode,
              },
            }
          : {}),
      });
      await refreshProjects();
      await openProject(result.pattern.patternId);
      setDialog(null);
      notify(
        originals.length
          ? "图纸已导入；原始附件已归档，视觉一致性未验证"
          : "图纸已导入",
      );
    });
  const createPattern = () =>
    void run(async () => {
      const palette =
        presets.find((v) => v.palette.id === newPreset)?.palette ?? p?.palette;
      if (!palette) throw new Error("请先导入有效色卡");
      const pattern: BeadPattern = {
        schemaVersion: "1.0",
        patternId: crypto.randomUUID(),
        revision: 1,
        title: newTitle,
        source: { producer: "Workbench" },
        grid: {
          width: newWidth,
          height: newHeight,
          origin: "top-left",
          coordinateBase: 1,
          cells: Array.from({ length: newHeight }, () =>
            Array(newWidth).fill(null),
          ),
        },
        palette: structuredClone(palette),
        layout: structuredClone(defaultLayout),
      };
      parsePattern(pattern);
      const next = await api<PatternState>("/patterns", "POST", pattern);
      await refreshProjects();
      await openProject(next.pattern.patternId);
      setDialog(null);
      notify("已创建图纸");
    });
  const showExport = (format: "svg" | "pdf") => {
    if (!p) return;
    setExportFormat(format);
    setExportRevision(p.revision);
    setExportScope("full");
    setDialog("export");
  };
  const exportFile = () =>
    void run(async () => {
      if (!p) return;
      let url = path + `/exports/${exportFormat}?revision=${exportRevision}`;
      if (exportFormat === "svg") url += `&mode=${exportMode}`;
      if (exportScope === "rect" && rect)
        url += `&x1=${rect.x1}&y1=${rect.y1}&x2=${rect.x2}&y2=${rect.y2}`;
      await download(url, `${p.patternId}-v${exportRevision}.${exportFormat}`);
      setDialog(null);
      notify(`已导出 v${exportRevision} ${exportFormat.toUpperCase()}`);
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        dialog ||
        preview ||
        (e.target as HTMLElement).matches("input,select,textarea")
      )
        return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") {
          e.preventDefault();
          if (e.shiftKey && state?.canRedo) travel("redo");
          else if (state?.canUndo) travel("undo");
        }
        if (e.key === "y") {
          e.preventDefault();
          if (state?.canRedo) travel("redo");
        }
        if (e.key === "s") {
          e.preventDefault();
          void run(async () => {
            if (p)
              await download(
                path + `/exports/json?revision=${p.revision}`,
                `${p.patternId}-v${p.revision}.json`,
              );
          });
        }
        return;
      }
      const item = tools.find(
        (t) => t.key.toLowerCase() === e.key.toLowerCase(),
      );
      if (item) setTool(item.id);
      if (e.key === "0") setFitNonce((n) => n + 1);
      if (e.key === "Escape") {
        setRect(null);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, preview, state, busy]);
  const paletteOptions = (empty = true) => (
    <>
      {empty && <option value="">空格（无珠子）</option>}
      {p &&
        Object.entries(p.palette.colors).map(([code, c]) => (
          <option key={code} value={code}>
            {code} · {c.name}
          </option>
        ))}
    </>
  );
  const usedBoard = stats?.boards.find((b) => b.id === boardFilter);
  const materialColors =
    stats?.colors
      .map((c) => ({
        ...c,
        count: usedBoard ? (usedBoard.colors[c.code] ?? 0) : c.count,
        percentage: usedBoard
          ? ((usedBoard.colors[c.code] ?? 0) / (usedBoard.beadCount || 1)) * 100
          : c.percentage,
      }))
      .filter(
        (c) =>
          c.count > 0 &&
          `${c.code} ${c.name}`
            .toLowerCase()
            .includes(statsSearch.toLowerCase()),
      )
      .sort((a, b) => (sortAsc ? a.count - b.count : b.count - a.count)) ?? [];
  const filteredPalette = p
    ? Object.entries(p.palette.colors)
        .filter(([code, c]) =>
          `${code} ${c.name}`.toLowerCase().includes(colorSearch.toLowerCase()),
        )
        .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    : [];
  const usedColorCounts = new Map(
    stats?.colors.map((c) => [c.code, c.count]) ?? [],
  );
  const usedPalette = filteredPalette.filter(([code]) =>
    usedColorCounts.has(code),
  );
  const remainingGroups = new Map<string, typeof filteredPalette>();
  for (const entry of filteredPalette) {
    if (usedColorCounts.has(entry[0])) continue;
    const letter = entry[0].match(/^[A-Za-z]/)?.[0].toUpperCase() ?? "其他";
    if (!remainingGroups.has(letter)) remainingGroups.set(letter, []);
    remainingGroups.get(letter)!.push(entry);
  }
  const colorButtons = (entries: typeof filteredPalette, used = false) =>
    entries.map(([code, c]) => (
      <button
        key={code}
        title={`${code} · ${c.hex}${used ? ` · ${number(usedColorCounts.get(code) ?? 0)} 颗` : ""}`}
        aria-label={`选择色号 ${code}`}
        aria-pressed={color === code}
        className={color === code ? "chosen" : ""}
        disabled={busy}
        onClick={() => {
          setColor(code);
          setTool("brush");
        }}
      >
        <Swatch hex={c.hex} />
        <span>{code}</span>
        {used && <small>{number(usedColorCounts.get(code) ?? 0)}</small>}
        {color === code && (
          <i>
            <Check size={9} />
          </i>
        )}
      </button>
    ));
  const toggleLayout = (fn: (l: Layout) => void) =>
    void run(async () => {
      if (!p) return;
      const next = structuredClone(p.layout);
      fn(next);
      applyState(
        await api<PatternState>(path + "/layout", "PUT", {
          baseRevision: p.revision,
          layout: next,
        }),
      );
      await refreshProjects();
    });
  if (auth === "login")
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </div>
          <h1>拼豆图纸工作台</h1>
          <p>输入管理员访问密钥以打开工作台。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/session/login", "POST", { token: loginToken });
                setLoginToken("");
                await load();
                setAuth("ready");
              });
            }}
          >
            <label>
              访问密钥
              <input
                type="password"
                autoComplete="current-password"
                aria-label="访问密钥"
                value={loginToken}
                onChange={(e) => setLoginToken(e.target.value)}
                required
              />
            </label>
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              打开工作台
            </button>
          </form>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div>
            <strong>拼豆图纸</strong>
          </div>
        </div>
        <button className="header-help" onClick={() => setDialog("shortcuts")}>
          <Info size={15} />
          帮助
        </button>
      </header>
      <div className="workspace-body">
        <aside className="project-sidebar">
          <div className="sidebar-top">
            <span>图纸</span>
            <button
              className="icon-button"
              aria-label="新建图纸"
              title="新建图纸"
              onClick={() => setDialog("new")}
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="search-box">
            <Search size={14} />
            <input
              aria-label="搜索图纸"
              placeholder="搜索图纸…"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
          </div>
          <div className="project-list">
            {projects
              .filter(
                (v) =>
                  v.title.includes(projectSearch) ||
                  v.id.includes(projectSearch),
              )
              .map((v) => (
                <button
                  key={v.id}
                  className={
                    "project-item" + (v.id === p?.patternId ? " selected" : "")
                  }
                  onClick={() => void run(() => openProject(v.id))}
                  disabled={busy}
                >
                  <span className="project-icon">
                    <Grid2X2 size={16} />
                  </span>
                  <span>
                    <strong>{v.title}</strong>
                    <small>
                      {v.width} × {v.height}
                      <span>v{v.revision}</span>
                    </small>
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
            {projects.length === 0 && (
              <p className="empty-note">导入 JSON 图纸，开始编辑。</p>
            )}
          </div>
          <button
            className="sidebar-import"
            onClick={() => {
              setJsonFile(null);
              setImportInfo(null);
              setOriginalFiles([]);
              setDialog("import");
            }}
          >
            <Plus size={16} />
            导入新图纸
          </button>
          <div className="sidebar-bottom">
            <div className="palette-source">
              <PaletteIcon size={18} />
              <strong>MARD 221 色卡</strong>
              <span className="small-check">
                <Check size={12} />
              </span>
              <button
                onClick={() =>
                  void run(async () => {
                    const palette = presets[0]?.palette;
                    if (palette) await download("/palettes", "palettes.json");
                  })
                }
              >
                下载色卡 <ArrowDownToLine size={12} />
              </button>
            </div>
            <button
              className="sidebar-link"
              onClick={() => setDialog("shortcuts")}
            >
              <Info size={16} />
              快捷键
            </button>
          </div>
        </aside>
        <main className="main-workspace">
          <div className="project-heading">
            <div>
              <div className="project-title">
                <h1>{p?.title ?? "拼豆图纸工作台"}</h1>
                {p && <span className="revision-chip">v{p.revision}</span>}
                <span
                  className="saved-indicator"
                  aria-label={busy ? "处理中" : "已保存"}
                  title={busy ? "处理中" : "已保存"}
                >
                  <Check size={13} />
                </span>
              </div>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                disabled={!p || busy}
                onClick={() =>
                  void run(async () => {
                    if (p)
                      await download(
                        path + `/exports/json?revision=${p.revision}`,
                        `${p.patternId}-v${p.revision}.json`,
                      );
                  })
                }
              >
                <FileJson size={15} />
                保存 JSON
              </button>
              <button
                className="button"
                disabled={!p || busy}
                onClick={() => showExport("svg")}
              >
                <ArrowDownToLine size={15} />
                SVG
              </button>
              <button
                className="primary"
                disabled={!p || busy}
                onClick={() => showExport("pdf")}
              >
                <Download size={15} />
                导出 PDF
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Info size={16} />
              <span>{error}</span>
              <IconButton
                icon={X}
                label="关闭错误"
                onClick={() => setError("")}
              />
            </div>
          )}
          <div className="editor-row">
            <div className="canvas-column">
              <div className="canvas-toolbar">
                <div className="toolbar-group">
                  <IconButton
                    icon={Undo2}
                    label="撤销 (Ctrl+Z)"
                    onClick={() => travel("undo")}
                    disabled={!state?.canUndo || busy}
                  />
                  <IconButton
                    icon={Redo2}
                    label="重做 (Ctrl+Y)"
                    onClick={() => travel("redo")}
                    disabled={!state?.canRedo || busy}
                  />
                  <span className="divider" />
                  <button
                    className={
                      "toolbar-text" +
                      (p?.layout.gridLines.show ? " active" : "")
                    }
                    disabled={!p || busy}
                    onClick={() =>
                      toggleLayout((l) => {
                        l.gridLines.show = !l.gridLines.show;
                      })
                    }
                  >
                    <Grid2X2 size={15} />
                    网格
                  </button>
                  <button
                    className={
                      "toolbar-text" +
                      (p?.layout.coordinates.show ? " active" : "")
                    }
                    disabled={!p || busy}
                    onClick={() =>
                      toggleLayout((l) => {
                        l.coordinates.show = !l.coordinates.show;
                      })
                    }
                  >
                    <Crosshair size={15} />
                    坐标
                  </button>
                  <button
                    className={
                      "toolbar-text" +
                      (p?.layout.board.show !== false ? " active" : "")
                    }
                    disabled={!p || busy}
                    onClick={() =>
                      toggleLayout((l) => {
                        l.board.show = l.board.show === false;
                      })
                    }
                  >
                    <Layers size={15} />
                    拼板
                  </button>
                  <button
                    className={
                      "toolbar-text" +
                      (p?.layout.showColorCodes ? " active" : "")
                    }
                    role="switch"
                    aria-label="显示色号"
                    title="显示色号"
                    aria-checked={p?.layout.showColorCodes ?? false}
                    disabled={!p || busy}
                    onClick={() =>
                      toggleLayout((l) => {
                        l.showColorCodes = !l.showColorCodes;
                      })
                    }
                  >
                    <Code2 size={15} />
                    色号
                  </button>
                  <button
                    className={
                      "toolbar-text" +
                      (p?.layout.board.showLabels ? " active" : "")
                    }
                    role="switch"
                    aria-label="拼板编号"
                    title="拼板编号"
                    aria-checked={p?.layout.board.showLabels ?? false}
                    disabled={!p || busy}
                    onClick={() =>
                      toggleLayout((l) => {
                        l.board.showLabels = !l.board.showLabels;
                      })
                    }
                  >
                    <Grid2X2 size={15} />
                    拼板编号
                  </button>
                </div>
                <div className="toolbar-group">
                  <button
                    className="toolbar-text"
                    onClick={openHistory}
                    disabled={!p || busy}
                  >
                    <History size={15} />
                    版本记录
                  </button>
                  <IconButton
                    icon={Ellipsis}
                    label="项目与原始文件"
                    onClick={() => setDialog("archives")}
                    disabled={!p}
                  />
                </div>
              </div>
              <div className="canvas-stage">
                <div className="vertical-tools">
                  {tools.map((t) => (
                    <IconButton
                      key={t.id}
                      icon={t.icon}
                      label={`${t.label} (${t.key})`}
                      active={tool === t.id}
                      onClick={() => setTool(t.id)}
                      disabled={!p || busy}
                    />
                  ))}
                  <span className="tool-rule" />
                  <IconButton
                    icon={ZoomIn}
                    label="放大"
                    onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                  />
                  <IconButton
                    icon={Maximize}
                    label="适应窗口 (0)"
                    onClick={() => setFitNonce((n) => n + 1)}
                  />
                  <span className="tool-rule" />
                  <button
                    className="active-color"
                    aria-label="当前画笔颜色"
                    onClick={() => setTab("pattern")}
                    style={{
                      background:
                        color && p ? p.palette.colors[color]?.hex : "#FFF",
                    }}
                  >
                    {color === null && <X size={15} />}
                  </button>
                </div>
                {p ? (
                  <PatternCanvas
                    pattern={p}
                    tool={tool}
                    color={color}
                    zoom={zoom}
                    onZoom={setZoom}
                    selected={selected}
                    onSelect={setSelected}
                    onHover={setHover}
                    rect={rect}
                    onRect={setRect}
                    onStroke={stroke}
                    onPick={(c) => {
                      setColor(c);
                      setTool("brush");
                    }}
                    fitNonce={fitNonce}
                    focusNonce={focusNonce}
                    busy={busy || !!preview}
                    highlight={highlight}
                  />
                ) : (
                  <div className="empty-canvas">
                    <Grid2X2 size={48} />
                    <h2>
                      {auth === "loading"
                        ? "正在打开工作区…"
                        : "开始你的下一张图纸"}
                    </h2>
                    <button
                      className="primary"
                      onClick={() => setDialog("import")}
                    >
                      <ArrowUpFromLine size={16} />
                      导入图纸
                    </button>
                  </div>
                )}
                <div className="zoom-controls">
                  <IconButton
                    icon={Minus}
                    label="缩小"
                    onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}
                  />
                  <span>{Math.round(zoom * 100)}%</span>
                  <IconButton
                    icon={Plus}
                    label="放大画布"
                    onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                  />
                  <span className="divider" />
                  <IconButton
                    icon={Expand}
                    label="适应画布"
                    onClick={() => setFitNonce((n) => n + 1)}
                  />
                </div>
              </div>
              <div className="canvas-bottom">
                <span>
                  <MousePointer2 size={13} />
                  {tools.find((t) => t.id === tool)?.label}
                </span>
                <span className="mono">
                  {hover ? `X ${hover.x} / Y ${hover.y}` : "X — / Y —"}
                  <span className="coordinate-color">
                    {hover && p
                      ? (p.grid.cells[hover.y - 1][hover.x - 1] ?? "空格")
                      : "—"}
                  </span>
                </span>
              </div>
            </div>
            <aside className="inspector">
              <div className="inspector-tabs">
                {(
                  [
                    ["pattern", "图纸"],
                    ["materials", "材料统计"],
                    ["layout", "排版"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    className={tab === id ? "selected" : ""}
                    key={id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="inspector-scroll">
                {p && stats && tab === "pattern" && (
                  <>
                    <section>
                      <div className="section-heading">
                        <h3>图纸信息</h3>
                        <Grid2X2 size={14} />
                      </div>
                      <div className="info-grid">
                        <div>
                          <span>图纸尺寸</span>
                          <strong>
                            {p.grid.width} × {p.grid.height}
                            <small> 格</small>
                          </strong>
                        </div>
                        <div>
                          <span>珠子总数</span>
                          <strong>
                            {number(stats.beadCount)}
                            <small> 颗</small>
                          </strong>
                        </div>
                        <div>
                          <span>使用颜色</span>
                          <strong>
                            {stats.colorCount}
                            <small> 色</small>
                          </strong>
                        </div>
                        <div>
                          <span>空格数量</span>
                          <strong>
                            {number(stats.emptyCount)}
                            <small> 格</small>
                          </strong>
                        </div>
                      </div>
                      <div className="palette-binding">
                        <PaletteIcon size={14} />
                        <span>{p.palette.id}</span>
                        <button
                          onClick={() => {
                            setPaletteInput(null);
                            setDialog("palette");
                          }}
                          title="绑定色卡"
                        >
                          <Settings2 size={13} />
                        </button>
                      </div>
                    </section>
                    <section className="palette-section">
                      <div className="section-heading">
                        <h3>
                          颜色选择
                          <span>{Object.keys(p.palette.colors).length}</span>
                        </h3>
                        <button
                          className="link-button"
                          onClick={() => {
                            setColor(null);
                            setTool("eraser");
                          }}
                        >
                          设为空格
                        </button>
                      </div>
                      <div className="search-box">
                        <Search size={14} />
                        <input
                          aria-label="搜索色卡"
                          placeholder="搜索色号"
                          value={colorSearch}
                          onChange={(e) => setColorSearch(e.target.value)}
                        />
                      </div>
                      <div className="used-palette" aria-label="图纸已用颜色">
                        <div className="palette-group-heading">
                          <h4>图纸已用</h4>
                          <span>{usedPalette.length}</span>
                        </div>
                        <div className="color-grid">
                          {colorButtons(usedPalette, true)}
                        </div>
                        {!usedPalette.length && (
                          <p className="palette-empty">
                            {colorSearch ? "无匹配色号" : "暂无已用颜色"}
                          </p>
                        )}
                      </div>
                      <div className="remaining-palette" aria-label="剩余颜色">
                        <div className="palette-group-heading">
                          <h4>剩余颜色</h4>
                          <span>
                            {filteredPalette.length - usedPalette.length}
                          </span>
                        </div>
                        {Array.from(remainingGroups, ([letter, entries]) => (
                          <details
                            className="palette-group"
                            key={`${letter}-${!!colorSearch}`}
                            open={!!colorSearch || letter === "A"}
                          >
                            <summary>
                              <strong>{letter}</strong>
                              <span>{entries.length}</span>
                              <ChevronDown size={13} />
                            </summary>
                            <div className="color-grid">
                              {colorButtons(entries)}
                            </div>
                          </details>
                        ))}
                      </div>
                    </section>
                  </>
                )}
                {p && stats && tab === "materials" && (
                  <>
                    <section>
                      <div className="section-heading">
                        <h3>材料总览</h3>
                        <button
                          className="link-button"
                          onClick={() =>
                            void run(() =>
                              download(
                                path +
                                  `/stats?revision=${p.revision}&format=csv`,
                                `materials-v${p.revision}.csv`,
                              ),
                            )
                          }
                        >
                          <Download size={13} />
                          CSV
                        </button>
                      </div>
                      <div className="materials-total">
                        <span>
                          {number(usedBoard?.beadCount ?? stats.beadCount)}
                        </span>
                        <small>颗珠子</small>
                        <div>
                          {usedBoard ? usedBoard.id : "整张图纸"} ·{" "}
                          {stats.colorCount} 种颜色
                        </div>
                      </div>
                      <label className="field-label">
                        统计范围
                        <select
                          aria-label="统计范围"
                          value={boardFilter}
                          onChange={(e) => {
                            setBoardFilter(e.target.value);
                            setHighlight(null);
                          }}
                        >
                          <option value="">整张图纸</option>
                          {stats.boards.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.id} · {b.beadCount} 颗
                            </option>
                          ))}
                        </select>
                      </label>
                      {usedBoard && (
                        <p className="subtle-text">
                          X {usedBoard.rect.x1}–{usedBoard.rect.x2} / Y{" "}
                          {usedBoard.rect.y1}–{usedBoard.rect.y2} · 空格{" "}
                          {usedBoard.emptyCount}
                        </p>
                      )}
                      <button
                        className="button full-width"
                        onClick={() =>
                          void run(() =>
                            download(
                              path + `/stats?revision=${p.revision}`,
                              `materials-v${p.revision}.json`,
                            ),
                          )
                        }
                      >
                        <FileJson size={14} />
                        导出统计 JSON
                      </button>
                    </section>
                    <section>
                      <div className="search-box">
                        <Search size={14} />
                        <input
                          aria-label="搜索统计色号"
                          placeholder="搜索色号"
                          value={statsSearch}
                          onChange={(e) => setStatsSearch(e.target.value)}
                        />
                      </div>
                      <div className="material-list-heading">
                        <span>色号 / 颜色</span>
                        <button onClick={() => setSortAsc((v) => !v)}>
                          用量
                          <ChevronsUpDown size={12} />
                        </button>
                      </div>
                      {materialColors.map((c) => (
                        <button
                          className={
                            "material-row" +
                            (highlight === c.code ? " highlighted" : "")
                          }
                          key={c.code}
                          title="点击高亮该颜色"
                          onClick={() =>
                            setHighlight((v) => (v === c.code ? null : c.code))
                          }
                        >
                          <Swatch hex={c.hex} />
                          <span>
                            <strong>{c.code}</strong>
                            <small>{c.name}</small>
                          </span>
                          <span>
                            <strong>{number(c.count)}</strong>
                            <small>{c.percentage.toFixed(1)}%</small>
                          </span>
                          <div
                            className="material-bar"
                            style={{
                              width: `${c.percentage}%`,
                              background: c.hex,
                            }}
                          />
                        </button>
                      ))}
                      {highlight && (
                        <button
                          className="link-button"
                          onClick={() => setHighlight(null)}
                        >
                          取消颜色高亮
                        </button>
                      )}
                    </section>
                    <section>
                      <div className="section-heading">
                        <h3>拼板分区</h3>
                        <span className="muted">{stats.boards.length} 块</span>
                      </div>
                      <div className="board-grid">
                        {stats.boards.map((b) => (
                          <button
                            className={boardFilter === b.id ? "chosen" : ""}
                            key={b.id}
                            onClick={() => {
                              setBoardFilter(b.id);
                              setRect(b.rect);
                              setSelected({ x: b.rect.x1, y: b.rect.y1 });
                              setFocusNonce((n) => n + 1);
                            }}
                          >
                            <strong>{b.id}</strong>
                            <span>{number(b.beadCount)} 颗</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </>
                )}
                {p && layoutDraft && tab === "layout" && (
                  <>
                    <section>
                      <div className="section-heading">
                        <h3>显示与坐标</h3>
                        <Settings2 size={14} />
                      </div>
                      <Toggle
                        label="显示网格线"
                        checked={layoutDraft.gridLines.show}
                        onChange={(v) =>
                          setLayoutDraft({
                            ...layoutDraft,
                            gridLines: { ...layoutDraft.gridLines, show: v },
                          })
                        }
                      />
                      <Toggle
                        label="显示坐标编号"
                        checked={layoutDraft.coordinates.show}
                        onChange={(v) =>
                          setLayoutDraft({
                            ...layoutDraft,
                            coordinates: {
                              ...layoutDraft.coordinates,
                              show: v,
                            },
                          })
                        }
                      />
                      <Toggle
                        label="格内显示色号"
                        checked={layoutDraft.showColorCodes ?? false}
                        onChange={(v) =>
                          setLayoutDraft({ ...layoutDraft, showColorCodes: v })
                        }
                      />
                      <Toggle
                        label="拼板编号"
                        checked={layoutDraft.board.showLabels ?? false}
                        onChange={(v) =>
                          setLayoutDraft({
                            ...layoutDraft,
                            board: { ...layoutDraft.board, showLabels: v },
                          })
                        }
                      />
                      <div className="two-fields">
                        <label>
                          每 X 格编号
                          <input
                            type="number"
                            aria-label="X 编号间隔"
                            min={1}
                            max={500}
                            value={layoutDraft.coordinates.intervalX}
                            onChange={(e) =>
                              setLayoutDraft({
                                ...layoutDraft,
                                coordinates: {
                                  ...layoutDraft.coordinates,
                                  intervalX: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          每 Y 格编号
                          <input
                            type="number"
                            aria-label="Y 编号间隔"
                            min={1}
                            max={500}
                            value={layoutDraft.coordinates.intervalY}
                            onChange={(e) =>
                              setLayoutDraft({
                                ...layoutDraft,
                                coordinates: {
                                  ...layoutDraft.coordinates,
                                  intervalY: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="interval-presets">
                        {[1, 5, 10].map((v) => (
                          <button
                            key={v}
                            onClick={() =>
                              setLayoutDraft({
                                ...layoutDraft,
                                coordinates: {
                                  ...layoutDraft.coordinates,
                                  intervalX: v,
                                  intervalY: v,
                                },
                              })
                            }
                          >
                            每 {v} 格
                          </button>
                        ))}
                      </div>
                    </section>
                    <section>
                      <div className="section-heading">
                        <h3>物理尺寸与拼板</h3>
                        <Layers size={14} />
                      </div>
                      <label className="field-label">
                        单格尺寸（mm）
                        <input
                          type="number"
                          aria-label="单格尺寸"
                          min={1}
                          max={20}
                          step={0.1}
                          value={layoutDraft.cellSizeMm}
                          onChange={(e) =>
                            setLayoutDraft({
                              ...layoutDraft,
                              cellSizeMm: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <Toggle
                        label="显示拼板分区"
                        checked={layoutDraft.board.show !== false}
                        onChange={(v) =>
                          setLayoutDraft({
                            ...layoutDraft,
                            board: { ...layoutDraft.board, show: v },
                          })
                        }
                      />
                      <div className="two-fields">
                        <label>
                          拼板宽度
                          <input
                            type="number"
                            aria-label="拼板宽度"
                            min={1}
                            max={500}
                            value={layoutDraft.board.width}
                            onChange={(e) =>
                              setLayoutDraft({
                                ...layoutDraft,
                                board: {
                                  ...layoutDraft.board,
                                  width: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          拼板高度
                          <input
                            type="number"
                            aria-label="拼板高度"
                            min={1}
                            max={500}
                            value={layoutDraft.board.height}
                            onChange={(e) =>
                              setLayoutDraft({
                                ...layoutDraft,
                                board: {
                                  ...layoutDraft.board,
                                  height: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="interval-presets">
                        {[29, 50].map((v) => (
                          <button
                            key={v}
                            onClick={() =>
                              setLayoutDraft({
                                ...layoutDraft,
                                board: {
                                  ...layoutDraft.board,
                                  width: v,
                                  height: v,
                                },
                              })
                            }
                          >
                            {v} × {v}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section>
                      <div className="section-heading">
                        <h3>PDF 打印设置</h3>
                        <FileText size={14} />
                      </div>
                      <div className="two-fields">
                        <label>
                          纸张
                          <select
                            aria-label="PDF 纸张"
                            value={layoutDraft.paper.size}
                            onChange={(e) =>
                              setLayoutDraft({
                                ...layoutDraft,
                                paper: {
                                  ...layoutDraft.paper,
                                  size: e.target
                                    .value as Layout["paper"]["size"],
                                  widthMm: layoutDraft.paper.widthMm ?? 210,
                                  heightMm: layoutDraft.paper.heightMm ?? 297,
                                },
                              })
                            }
                          >
                            <option>A4</option>
                            <option>A3</option>
                            <option value="custom">自定义</option>
                          </select>
                        </label>
                        <label>
                          方向
                          <select
                            value={layoutDraft.paper.orientation}
                            onChange={(e) =>
                              setLayoutDraft({
                                ...layoutDraft,
                                paper: {
                                  ...layoutDraft.paper,
                                  orientation: e.target.value as
                                    | "portrait"
                                    | "landscape",
                                },
                              })
                            }
                          >
                            <option value="portrait">纵向</option>
                            <option value="landscape">横向</option>
                          </select>
                        </label>
                      </div>
                      {layoutDraft.paper.size === "custom" && (
                        <div className="two-fields">
                          <label>
                            宽（mm）
                            <input
                              type="number"
                              min={100}
                              max={1000}
                              value={layoutDraft.paper.widthMm ?? 210}
                              onChange={(e) =>
                                setLayoutDraft({
                                  ...layoutDraft,
                                  paper: {
                                    ...layoutDraft.paper,
                                    widthMm: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            高（mm）
                            <input
                              type="number"
                              min={100}
                              max={1000}
                              value={layoutDraft.paper.heightMm ?? 297}
                              onChange={(e) =>
                                setLayoutDraft({
                                  ...layoutDraft,
                                  paper: {
                                    ...layoutDraft.paper,
                                    heightMm: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                      <label className="field-label">
                        打印边距（mm）
                        <input
                          type="number"
                          min={0}
                          max={50}
                          value={layoutDraft.paper.marginMm}
                          onChange={(e) =>
                            setLayoutDraft({
                              ...layoutDraft,
                              paper: {
                                ...layoutDraft.paper,
                                marginMm: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label className="field-label">
                        分页方式
                        <select
                          value={layoutDraft.paper.pagination ?? "auto"}
                          onChange={(e) =>
                            setLayoutDraft({
                              ...layoutDraft,
                              paper: {
                                ...layoutDraft.paper,
                                pagination: e.target.value as "auto" | "board",
                              },
                            })
                          }
                        >
                          <option value="auto">按可打印区域分页</option>
                          <option value="board">按拼板分页</option>
                        </select>
                      </label>
                      <button
                        className="primary full-width"
                        disabled={
                          busy ||
                          JSON.stringify(layoutDraft) ===
                            JSON.stringify(p.layout)
                        }
                        onClick={() =>
                          void run(async () => {
                            applyState(
                              await api<PatternState>(path + "/layout", "PUT", {
                                baseRevision: p.revision,
                                layout: layoutDraft,
                              }),
                            );
                            await refreshProjects();
                            notify("排版已保存，珠子数据保持一致");
                          })
                        }
                      >
                        保存排版设置
                      </button>
                    </section>
                  </>
                )}
              </div>
              <div className="inspector-footer">
                <button onClick={openBatch} disabled={!p || busy}>
                  <Settings2 size={15} />
                  {rect ? "编辑所选区域" : "批量换色"}
                  <ChevronRight size={14} />
                </button>
                {rect && (
                  <small>
                    X {rect.x1}–{rect.x2} · Y {rect.y1}–{rect.y2}
                  </small>
                )}
              </div>
            </aside>
          </div>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {preview && (
        <Modal title="确认修改" onClose={() => setPreview(null)} wide>
          <div className="modal-body">
            <p className="modal-description">
              修改基于 v{preview.result.baseRevision}
              。确认后保存为新的修订版本。
            </p>
            <div className="preview-numbers">
              <div>
                <strong>{number(preview.result.changedCells)}</strong>
                <span>受影响格子</span>
              </div>
              <div>
                <strong>
                  {preview.result.beadDelta > 0 ? "+" : ""}
                  {preview.result.beadDelta}
                </strong>
                <span>珠子总数变化</span>
              </div>
              <div>
                <strong>{number(preview.result.stats.beadCount)}</strong>
                <span>修改后总珠数</span>
              </div>
            </div>
            <div className="delta-list">
              {Object.entries(preview.result.colorDeltas).map(
                ([code, delta]) => (
                  <span key={code}>
                    <Swatch hex={p!.palette.colors[code].hex} small />
                    {code}
                    <b className={delta >= 0 ? "positive" : "negative"}>
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </b>
                  </span>
                ),
              )}
            </div>
            <div className="diff-table">
              <table>
                <thead>
                  <tr>
                    <th>坐标 (X,Y)</th>
                    <th>原色号</th>
                    <th>新色号</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.result.changes.slice(0, 150).map((c) => (
                    <tr key={`${c.x},${c.y}`}>
                      <td>
                        {c.x}, {c.y}
                      </td>
                      <td>{c.before ?? "空格"}</td>
                      <td>{c.after ?? "空格"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.result.changedCells > 150 && (
              <p className="subtle-text">
                显示前 150 格；本次将精确修改全部{" "}
                {number(preview.result.changedCells)} 格。
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setPreview(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy || !preview.result.changedCells}
              onClick={() => void run(() => commit(preview.request))}
            >
              确认修改 {number(preview.result.changedCells)} 格
            </button>
          </div>
        </Modal>
      )}
      {dialog === "import" && !preview && (
        <Modal title="导入拼豆图纸" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="modal-description">
              支持 BeadPattern v1 和旧版 MARD 221 网格 JSON。原始 SVG / PDF
              可一起归档。
            </p>
            <label
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void selectFile(e.dataTransfer.files[0]);
              }}
            >
              <FileJson size={30} />
              <strong>{jsonFile?.name ?? "选择或拖入 JSON 文件"}</strong>
              <span>JSON 为必需输入 · 最大 16 MB</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="JSON 图纸文件"
                onChange={(e) => void selectFile(e.target.files?.[0])}
              />
            </label>
            {importInfo && (
              <div className="import-summary">
                <Check size={16} />
                <span>
                  {importInfo.title}
                  <small>
                    {importInfo.grid.width} × {importInfo.grid.height} ·{" "}
                    {importInfo.palette.id} ·{" "}
                    {calculateStats(importInfo).beadCount} 颗
                  </small>
                </span>
              </div>
            )}
            {importDetails?.format === "legacy-grid-v1" && (
              <div className="legacy-import-info">
                <p>
                  已识别旧版图纸，导入时转换为可编辑格式。原始 JSON 完整归档。
                </p>
                <label className="field-label">
                  导入色值
                  <select
                    aria-label="导入色值"
                    value={importPaletteMode}
                    disabled={busy}
                    onChange={(e) =>
                      changeImportPalette(e.target.value as ImportPaletteMode)
                    }
                  >
                    <option value="mard221">
                      使用您提供的 MARD 221 Excel 色卡
                    </option>
                    <option value="source">
                      保留文件内 HEX（标记为原文件色卡）
                    </option>
                  </select>
                </label>
                {importDetails.paletteConflicts.length > 0 && (
                  <details>
                    <summary>
                      {importDetails.paletteConflicts.length} 个色号的 HEX
                      与指定 MARD 色卡不同
                    </summary>
                    <table className="import-color-diff">
                      <thead>
                        <tr>
                          <th>色号</th>
                          <th>原文件 HEX</th>
                          <th>MARD HEX</th>
                          <th>颗数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importDetails.paletteConflicts.map((c) => (
                          <tr key={c.code}>
                            <td>{c.code}</td>
                            <td>{c.sourceHex}</td>
                            <td>{c.mardHex}</td>
                            <td>{number(c.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                <p className="subtle-text">
                  {importPaletteMode === "mard221"
                    ? "按原色号绑定指定色卡，只调整显示色值；全部格子的色号、位置和豆数保持原样。"
                    : "显示采用文件内 HEX，色卡标记为 MARD-221-source，避免与指定 Excel 色卡混淆。"}
                </p>
                {importDetails.warnings.map((warning, i) => (
                  <p className="subtle-text" key={i}>
                    {warning}
                  </p>
                ))}
              </div>
            )}
            <label className="field-label">
              原始附件（可选，最多 2 个）
              <input
                type="file"
                multiple
                accept=".svg,.pdf"
                aria-label="原始 SVG PDF 附件"
                onChange={(e) =>
                  setOriginalFiles(Array.from(e.target.files ?? []).slice(0, 2))
                }
              />
            </label>
            <p className="subtle-text">
              预览从 JSON 重新生成。原始附件独立保存，未验证其与 JSON
              的视觉一致性。
            </p>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!jsonFile || busy}
              onClick={importPattern}
            >
              导入图纸
            </button>
          </div>
        </Modal>
      )}
      {dialog === "new" && (
        <Modal title="新建空白图纸" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createPattern();
            }}
          >
            <div className="modal-body">
              <label className="field-label">
                图纸名称
                <input
                  required
                  maxLength={200}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </label>
              <div className="two-fields">
                <label>
                  宽度（格）
                  <input
                    required
                    type="number"
                    min={1}
                    max={500}
                    value={newWidth}
                    onChange={(e) => setNewWidth(Number(e.target.value))}
                  />
                </label>
                <label>
                  高度（格）
                  <input
                    required
                    type="number"
                    min={1}
                    max={500}
                    value={newHeight}
                    onChange={(e) => setNewHeight(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="field-label">
                绑定色卡
                <select
                  value={newPreset}
                  onChange={(e) => setNewPreset(e.target.value)}
                >
                  {presets.map((v) => (
                    <option key={v.palette.id}>{v.palette.id}</option>
                  ))}
                  {p && !presets.some((v) => v.palette.id === p.palette.id) && (
                    <option>{p.palette.id}</option>
                  )}
                </select>
              </label>
              <p className="subtle-text">
                所有格子初始为空格。色号始终来自选定版本的色卡。
              </p>
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                创建图纸
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "batch" && !preview && p && (
        <Modal title="批量修改" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <label className="field-label">
              操作类型
              <select
                value={batchMode}
                onChange={(e) =>
                  setBatchMode(e.target.value as typeof batchMode)
                }
              >
                <option value="replace">指定色号替换</option>
                <option value="fill">统一区域颜色</option>
                <option value="clear">清空区域</option>
              </select>
            </label>
            <label className="field-label">
              修改范围
              <select
                aria-label="批量修改范围"
                value={batchScope}
                onChange={(e) =>
                  setBatchScope(e.target.value as typeof batchScope)
                }
              >
                <option value="global">整张图纸</option>
                <option value="rect">指定矩形区域</option>
              </select>
            </label>
            {batchScope === "rect" && (
              <div className="rect-fields">
                {(["x1", "y1", "x2", "y2"] as const).map((k) => (
                  <label key={k}>
                    {k.toUpperCase()}
                    <input
                      type="number"
                      min={1}
                      max={k.startsWith("x") ? p.grid.width : p.grid.height}
                      value={batchRect[k]}
                      onChange={(e) =>
                        setBatchRect({
                          ...batchRect,
                          [k]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            {batchMode === "replace" && (
              <label className="field-label">
                原色号
                <select
                  aria-label="批量原色号"
                  value={batchOld ?? ""}
                  onChange={(e) => setBatchOld(e.target.value || null)}
                >
                  {paletteOptions()}
                </select>
              </label>
            )}
            {batchMode !== "clear" && (
              <label className="field-label">
                目标色号
                <select
                  aria-label="批量目标色号"
                  value={batchNew ?? ""}
                  onChange={(e) => setBatchNew(e.target.value || null)}
                >
                  {paletteOptions()}
                </select>
              </label>
            )}
            {batchMode === "fill" && (
              <Toggle
                label="仅修改非空格，保留空格"
                checked={batchNonempty}
                onChange={setBatchNonempty}
              />
            )}
            <p className="subtle-text">
              下一步显示受影响格子及用量变化，确认后才会提交。
            </p>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={batchPrepare}>
              预览修改
            </button>
          </div>
        </Modal>
      )}
      {dialog === "history" && p && (
        <Modal title="版本记录与比较" onClose={() => setDialog(null)} wide>
          <div className="modal-body">
            <p className="modal-description">
              每次编辑均保存独立版本。恢复历史会创建新版本并保留现有记录。
            </p>
            <div className="diff-controls">
              <label>
                原版本
                <select
                  aria-label="比较原版本"
                  value={diffFrom}
                  onChange={(e) => setDiffFrom(Number(e.target.value))}
                >
                  {history.map((v) => (
                    <option key={v.revision} value={v.revision}>
                      v{v.revision}
                    </option>
                  ))}
                </select>
              </label>
              <ChevronRight size={16} />
              <label>
                目标版本
                <select
                  aria-label="比较目标版本"
                  value={diffTo}
                  onChange={(e) => setDiffTo(Number(e.target.value))}
                >
                  {history.map((v) => (
                    <option key={v.revision} value={v.revision}>
                      v{v.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setDifferences(
                      (
                        await api<{ changes: CellDiff[] }>(
                          path + `/diff?from=${diffFrom}&to=${diffTo}`,
                        )
                      ).changes,
                    ),
                  )
                }
              >
                比较差异
              </button>
            </div>
            {differences && (
              <div className="comparison-result">
                共 {number(differences.length)} 格差异
                {differences.length > 0 && (
                  <div className="diff-table">
                    <table>
                      <thead>
                        <tr>
                          <th>坐标</th>
                          <th>原色号</th>
                          <th>新色号</th>
                        </tr>
                      </thead>
                      <tbody>
                        {differences.slice(0, 100).map((c) => (
                          <tr key={`${c.x},${c.y}`}>
                            <td>
                              ({c.x}, {c.y})
                            </td>
                            <td>{c.before ?? "空格"}</td>
                            <td>{c.after ?? "空格"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            <div className="history-list">
              {history.map((v) => (
                <div className="history-row" key={v.revision}>
                  <span className="history-dot" />
                  <div>
                    <strong>
                      v{v.revision}
                      <span>{operationLabels[v.type] ?? v.type}</span>
                      {v.revision === p.revision && <b>当前</b>}
                    </strong>
                    <small>
                      {new Date(v.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {number(v.changedCells)} 格修改
                    </small>
                    <code>{v.digest.slice(0, 24)}…</code>
                  </div>
                  <button
                    className="button"
                    disabled={v.revision === p.revision || busy}
                    onClick={() => setRestoreTarget(v.revision)}
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
            {restoreTarget && (
              <div className="restore-confirm">
                <span>
                  将 v{restoreTarget} 恢复为新版本 v{p.revision + 1}？
                </span>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      applyState(
                        await api<PatternState>(
                          path + `/revisions/${restoreTarget}/restore`,
                          "POST",
                          { baseRevision: p.revision },
                        ),
                      );
                      await refreshProjects();
                      setDialog(null);
                      notify(`已恢复 v${restoreTarget}，历史记录全部保留`);
                    })
                  }
                >
                  确认恢复
                </button>
              </div>
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </div>
        </Modal>
      )}
      {dialog === "export" && p && (
        <Modal
          title={`导出 ${exportFormat.toUpperCase()} 矢量图纸`}
          onClose={() => setDialog(null)}
        >
          <div className="modal-body">
            <div className="export-card">
              <FileText size={28} />
              <div>
                <strong>{p.title}</strong>
                <span>
                  {p.grid.width} × {p.grid.height}
                </span>
              </div>
            </div>
            <label className="field-label">
              来源版本
              <input
                aria-label="导出版本"
                type="number"
                min={1}
                max={p.revision}
                value={exportRevision}
                onChange={(e) => setExportRevision(Number(e.target.value))}
              />
            </label>
            {exportFormat === "svg" && (
              <label className="field-label">
                SVG 模式
                <select
                  value={exportMode}
                  onChange={(e) => setExportMode(e.target.value)}
                >
                  <option value="layout">使用该版本排版设置</option>
                  <option value="plain">纯色块</option>
                  <option value="grid">带网格</option>
                  <option value="coordinates">带坐标编号</option>
                  <option value="boards">带拼板分区</option>
                </select>
              </label>
            )}
            <label className="field-label">
              输出范围
              <select
                value={exportScope}
                onChange={(e) =>
                  setExportScope(e.target.value as typeof exportScope)
                }
              >
                <option value="full">完整图纸</option>
                <option value="rect" disabled={!rect}>
                  当前矩形选区
                  {rect
                    ? ` (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2})`
                    : ""}
                </option>
              </select>
            </label>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={exportFile}>
              {busy ? "正在生成…" : "导出文件"}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "archives" && p && (
        <Modal title="项目与原始文件" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <div className="archive-info">
              <span>图纸 ID</span>
              <code>{p.patternId}</code>
              <span>当前数据摘要</span>
              <code>{state!.digest}</code>
            </div>
            <h3>原始档案</h3>
            <p className="subtle-text">
              原始文件保留导入时的内容。原始 SVG/PDF 与 JSON
              的视觉一致性未验证。
            </p>
            {state!.archives.map((a) => (
              <div className="archive-row" key={a.id}>
                <FileText size={18} />
                <span>
                  <strong>{a.name}</strong>
                  <small>{(a.bytes / 1024).toFixed(1)} KB · 原始文件</small>
                </span>
                <IconButton
                  icon={Download}
                  label={`下载 ${a.name}`}
                  onClick={() =>
                    void run(() => download(path + `/archives/${a.id}`, a.name))
                  }
                />
              </div>
            ))}
            <button
              className="danger-button full-width"
              onClick={() => setDialog("delete")}
            >
              <Trash2 size={14} />
              删除项目及全部档案
            </button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && p && (
        <Modal title="删除图纸项目" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p>
              确认删除「{p.title}
              」？此操作会删除图纸、所有历史版本及原始档案，无法撤销。
            </p>
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(path, "DELETE");
                  const list = await api<Project[]>("/patterns");
                  setProjects(list);
                  setState(null);
                  if (list.length) await openProject(list[0].id);
                  setDialog(null);
                  notify("项目已删除");
                })
              }
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {dialog === "palette" && p && (
        <Modal title="绑定色卡" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="modal-description">
              更换色卡不替换格子中的色号。新色卡必须包含图纸已使用的所有色号；相同色号的显示颜色可能改变。
            </p>
            {presets.map((v) => (
              <button
                key={v.palette.id}
                className={
                  "palette-preset" +
                  (paletteInput?.id === v.palette.id ? "chosen" : "")
                }
                onClick={() => setPaletteInput(v.palette)}
              >
                <PaletteIcon size={22} />
                <span>
                  <strong>
                    {v.palette.id} · {v.source.colorCount} 色
                  </strong>
                  <small>{v.source.sourceFile}</small>
                </span>
                <Check size={16} />
              </button>
            ))}
            <label className="field-label">
              或导入自定义色卡 JSON
              <input
                type="file"
                accept=".json"
                aria-label="自定义色卡 JSON"
                onChange={(e) =>
                  void run(async () => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (f.size > 512 * 1024)
                        throw new Error("色卡文件最大 512 KB");
                      const palette = JSON.parse(await f.text());
                      const candidate = {
                        ...p,
                        palette,
                        grid: {
                          ...p.grid,
                          cells: p.grid.cells.map((row) => row.map(() => null)),
                        },
                      };
                      parsePattern(candidate);
                      setPaletteInput(palette);
                    }
                  })
                }
              />
            </label>
            {paletteInput && (
              <div className="import-summary">
                <PaletteIcon size={16} />
                <span>
                  {paletteInput.id} · {Object.keys(paletteInput.colors).length}{" "}
                  色<small>{paletteInput.version}</small>
                </span>
              </div>
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!paletteInput || busy}
              onClick={() =>
                void run(async () => {
                  applyState(
                    await api<PatternState>(path + "/palette", "PUT", {
                      baseRevision: p.revision,
                      palette: paletteInput,
                    }),
                  );
                  setColor(Object.keys(paletteInput!.colors)[0]);
                  await refreshProjects();
                  setDialog(null);
                  notify("已明确绑定新色卡版本");
                })
              }
            >
              确认绑定色卡
            </button>
          </div>
        </Modal>
      )}
      {dialog === "shortcuts" && (
        <Modal title="使用帮助与快捷键" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p>选择色号后点击画布绘制；多格修改先预览，再确认。</p>
            <div className="shortcut-list">
              {tools.map((t) => (
                <div key={t.id}>
                  <span>{t.label}</span>
                  <kbd>{t.key}</kbd>
                </div>
              ))}
              <div>
                <span>适应窗口</span>
                <kbd>0</kbd>
              </div>
              <div>
                <span>缩放</span>
                <kbd>鼠标滚轮</kbd>
              </div>
              <div>
                <span>临时平移</span>
                <kbd>空格 + 拖动</kbd>
              </div>
              <div>
                <span>撤销 / 重做</span>
                <kbd>Ctrl+Z / Ctrl+Y</kbd>
              </div>
              <div>
                <span>保存 JSON</span>
                <kbd>Ctrl+S</kbd>
              </div>
            </div>
            <button
              className="link-button"
              onClick={() =>
                window.open("/api/v1/openapi.json", "_blank", "noopener")
              }
            >
              API 文档
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
