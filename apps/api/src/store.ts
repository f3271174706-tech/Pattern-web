import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { previewPatternImport, validateImportOptions, type LegacyImportOptions } from "../../../packages/core/src/import-pattern";
import {
  DomainError,
  applyEdits,
  calculateStats,
  diffPatterns,
  parsePattern,
  validatePattern,
} from "../../../packages/core/src/index";
import type {
  BeadPattern,
  EditRequest,
  Layout,
  Palette,
  RevisionSummary,
} from "../../../packages/core/src/types";
export const digestOf = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface ArchiveInput {
  name: string;
  format: "svg" | "pdf";
  base64: string;
}
type Row = {
  id: string;
  current_revision: number;
  undo_stack: string;
  redo_stack: string;
  created_at: string;
};
type RevisionRow = {
  data: string;
  revision: number;
  type: string;
  created_at: string;
  changes: string;
  digest: string;
  details: string;
};
export class PatternStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS patterns(id TEXT PRIMARY KEY,current_revision INTEGER NOT NULL,undo_stack TEXT NOT NULL DEFAULT '[]',redo_stack TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,revision INTEGER NOT NULL,data TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,changes TEXT NOT NULL,digest TEXT NOT NULL,details TEXT NOT NULL,PRIMARY KEY(pattern_id,revision));
      CREATE TABLE IF NOT EXISTS archives(id INTEGER PRIMARY KEY,pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,name TEXT NOT NULL,format TEXT NOT NULL,content BLOB NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,key TEXT NOT NULL,request_digest TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(pattern_id,key));
      CREATE TABLE IF NOT EXISTS exports(id INTEGER PRIMARY KEY,pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,revision INTEGER NOT NULL,format TEXT NOT NULL,data_digest TEXT NOT NULL,file_digest TEXT NOT NULL,created_at TEXT NOT NULL,options TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  row(id: string): Row {
    const r = this.db
      .prepare("SELECT * FROM patterns WHERE id=?")
      .get(id) as unknown as Row;
    if (!r)
      throw new DomainError(
        "PATTERN_NOT_FOUND",
        "图纸不存在",
        404,
        "/patternId",
      );
    return r;
  }
  revisionRow(id: string, revision?: number): RevisionRow {
    const row = this.row(id);
    const r = this.db
      .prepare("SELECT * FROM revisions WHERE pattern_id=? AND revision=?")
      .get(id, revision ?? row.current_revision) as unknown as RevisionRow;
    if (!r)
      throw new DomainError(
        "REVISION_NOT_FOUND",
        "修订版本不存在",
        404,
        "/revision",
      );
    return r;
  }
  get(id: string, revision?: number): BeadPattern {
    return JSON.parse(this.revisionRow(id, revision).data);
  }
  state(id: string) {
    const r = this.row(id),
      v = this.revisionRow(id);
    return {
      pattern: JSON.parse(v.data) as BeadPattern,
      digest: v.digest,
      canUndo: JSON.parse(r.undo_stack).length > 0,
      canRedo: JSON.parse(r.redo_stack).length > 0,
      archives: this.archives(id),
    };
  }
  currentPatterns(): BeadPattern[] {
    const rows = this.db
      .prepare(
        "SELECT r.data FROM patterns p JOIN revisions r ON r.pattern_id=p.id AND r.revision=p.current_revision ORDER BY r.created_at DESC,p.id ASC",
      )
      .all() as unknown as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as BeadPattern);
  }
  list() {
    return (
      this.db
        .prepare(
          "SELECT p.id,r.data,r.created_at,r.digest FROM patterns p JOIN revisions r ON r.pattern_id=p.id AND r.revision=p.current_revision ORDER BY r.created_at DESC",
        )
        .all() as unknown as {
        id: string;
        data: string;
        created_at: string;
        digest: string;
      }[]
    ).map((r) => {
      const p: BeadPattern = JSON.parse(r.data);
      const s = calculateStats(p);
      return {
        id: r.id,
        title: p.title,
        revision: p.revision,
        width: p.grid.width,
        height: p.grid.height,
        palette: p.palette.id,
        beadCount: s.beadCount,
        colorCount: s.colorCount,
        updatedAt: r.created_at,
        digest: r.digest,
      };
    });
  }
  archives(id: string) {
    return this.db
      .prepare(
        "SELECT id,name,format,digest,length(content) AS bytes FROM archives WHERE pattern_id=? ORDER BY id",
      )
      .all(id);
  }
  create(input: unknown, originals: ArchiveInput[] = [], rawJson?: string, importOptions?: LegacyImportOptions) {
    const p = parsePattern(input),
      original = rawJson ?? JSON.stringify(input, null, 2);
    let migration: ReturnType<typeof previewPatternImport> | undefined;
    if (importOptions !== undefined) {
      validateImportOptions(importOptions);
      if (!rawJson) throw new DomainError("MISSING_ORIGINAL_JSON", "旧版导入必须归档原始 JSON", 422, "/rawJson");
      migration = previewPatternImport(rawJson, { patternId: p.patternId, paletteMode: importOptions.paletteMode });
      if (migration.format !== importOptions.format) throw new DomainError("IMPORT_FORMAT_MISMATCH", "原始 JSON 与指定格式不符", 422, "/importOptions/format");
    }
    if (rawJson && digestOf(migration?.pattern ?? parsePattern(rawJson)) !== digestOf(p))
      throw new DomainError(
        "ORIGINAL_JSON_MISMATCH",
        "原始 JSON 与导入数据不一致",
        422,
        "/rawJson",
      );
    const checked = originals.map((a, i) => {
      if (
        !a ||
        !["svg", "pdf"].includes(a.format) ||
        typeof a.name !== "string" ||
        a.name.length > 255 ||
        typeof a.base64 !== "string" ||
        !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          a.base64,
        )
      )
        throw new DomainError(
          "INVALID_ARCHIVE",
          "附件字段无效",
          422,
          `/originals/${i}`,
        );
      const bytes = Buffer.from(a.base64, "base64");
      if (bytes.length > 8 * 1024 * 1024)
        throw new DomainError(
          "ARCHIVE_TOO_LARGE",
          "每个原始附件最大 8 MB",
          413,
          `/originals/${i}`,
        );
      if (
        a.format === "pdf" &&
        !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw new DomainError(
          "INVALID_ARCHIVE",
          "PDF 附件缺少有效文件头",
          422,
          `/originals/${i}`,
        );
      if (
        a.format === "svg" &&
        !bytes.toString("utf8").slice(0, 2048).includes("<svg")
      )
        throw new DomainError(
          "INVALID_ARCHIVE",
          "SVG 附件缺少 svg 文件头",
          422,
          `/originals/${i}`,
        );
      return { ...a, bytes };
    });
    if (checked.length > 2)
      throw new DomainError(
        "ARCHIVE_LIMIT",
        "最多导入两个原始 SVG/PDF 附件",
        422,
        "/originals",
      );
    p.revision = 1;
    return this.transaction(() => {
      if (
        this.db.prepare("SELECT id FROM patterns WHERE id=?").get(p.patternId)
      )
        throw new DomainError(
          "PATTERN_ID_EXISTS",
          "图纸 ID 已存在，请修改 patternId 或在已有项目中编辑",
          409,
          "/patternId",
        );
      const now = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO patterns(id,current_revision,created_at) VALUES (?,1,?)",
        )
        .run(p.patternId, now);
      this.insertRevision(p, "import", [], {
        importedRevision: (input as BeadPattern).revision,
        ...(migration ? { migration: { ...importOptions, paletteConflicts: migration.paletteConflicts, warnings: migration.warnings } } : {}),
      });
      const add = this.db.prepare(
        "INSERT INTO archives(pattern_id,name,format,content,digest) VALUES (?,?,?,?,?)",
      );
      const b = Buffer.from(original);
      add.run(
        p.patternId,
        "original.json",
        "json",
        b,
        createHash("sha256").update(b).digest("hex"),
      );
      for (const a of checked)
        add.run(
          p.patternId,
          a.name,
          a.format,
          a.bytes,
          createHash("sha256").update(a.bytes).digest("hex"),
        );
      return this.state(p.patternId);
    });
  }
  insertRevision(
    p: BeadPattern,
    type: string,
    changes: unknown[],
    details: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO revisions(pattern_id,revision,data,type,created_at,changes,digest,details) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        p.patternId,
        p.revision,
        JSON.stringify(p),
        type,
        new Date().toISOString(),
        JSON.stringify(changes),
        digestOf(p),
        JSON.stringify(details),
      );
  }
  private saveNext(
    id: string,
    next: BeadPattern,
    type: string,
    details: unknown,
    stacks?: { undo: number[]; redo: number[] },
  ) {
    const row = this.row(id),
      before = this.get(id);
    next.revision = before.revision + 1;
    validatePattern(next);
    const changes = diffPatterns(before, next);
    this.insertRevision(next, type, changes, details);
    const undo = stacks?.undo ?? [
        ...JSON.parse(row.undo_stack),
        before.revision,
      ],
      redo = stacks?.redo ?? [];
    this.db
      .prepare(
        "UPDATE patterns SET current_revision=?,undo_stack=?,redo_stack=? WHERE id=?",
      )
      .run(next.revision, JSON.stringify(undo), JSON.stringify(redo), id);
    return this.state(id);
  }
  checkBase(id: string, baseRevision: number) {
    const current = this.row(id).current_revision;
    if (!Number.isInteger(baseRevision))
      throw new DomainError(
        "INVALID_REVISION",
        "baseRevision 必须为整数",
        422,
        "/baseRevision",
      );
    if (baseRevision !== current)
      throw new DomainError(
        "REVISION_CONFLICT",
        `当前版本为 ${current}`,
        409,
        "/baseRevision",
        { currentRevision: current },
      );
  }
  preview(id: string, request: EditRequest) {
    return applyEdits(this.get(id), request).preview;
  }
  commit(id: string, request: EditRequest) {
    return this.transaction(() => {
      this.row(id);
      if (request.idempotencyKey) {
        const previous = this.db
          .prepare(
            "SELECT request_digest,response FROM idempotency WHERE pattern_id=? AND key=?",
          )
          .get(id, request.idempotencyKey) as
          | { request_digest: string; response: string }
          | undefined;
        if (previous) {
          if (previous.request_digest !== digestOf(request))
            throw new DomainError(
              "IDEMPOTENCY_KEY_REUSED",
              "幂等键已用于其他请求",
              409,
              "/idempotencyKey",
            );
          return JSON.parse(previous.response) as ReturnType<
            PatternStore["state"]
          >;
        }
      }
      const { pattern, preview } = applyEdits(this.get(id), request);
      if (!preview.changedCells)
        throw new DomainError(
          "NO_CHANGES",
          "操作没有改变格子",
          422,
          "/operations",
        );
      const result = this.saveNext(id, pattern, "edit", {
        operations: request.operations,
      });
      if (request.idempotencyKey)
        this.db
          .prepare("INSERT INTO idempotency VALUES (?,?,?,?)")
          .run(
            id,
            request.idempotencyKey,
            digestOf(request),
            JSON.stringify(result),
          );
      return result;
    });
  }
  updateLayout(id: string, baseRevision: number, layout: Layout) {
    return this.transaction(() => {
      this.checkBase(id, baseRevision);
      const p = this.get(id);
      p.layout = layout;
      validatePattern(p);
      return this.saveNext(id, p, "layout", { layout });
    });
  }
  bindPalette(id: string, baseRevision: number, palette: Palette) {
    return this.transaction(() => {
      this.checkBase(id, baseRevision);
      const p = this.get(id);
      p.palette = palette;
      validatePattern(p);
      return this.saveNext(id, p, "palette", {
        paletteId: palette.id,
        paletteVersion: palette.version,
      });
    });
  }
  history(id: string): RevisionSummary[] {
    this.row(id);
    return (
      this.db
        .prepare(
          "SELECT revision,type,created_at,changes,digest,details FROM revisions WHERE pattern_id=? ORDER BY revision DESC",
        )
        .all(id) as unknown as RevisionRow[]
    ).map((r) => ({
      revision: r.revision,
      type: r.type,
      createdAt: r.created_at,
      changedCells: JSON.parse(r.changes).length,
      digest: r.digest,
      details: JSON.parse(r.details),
    }));
  }
  restore(id: string, revision: number, baseRevision: number) {
    return this.transaction(() => {
      this.checkBase(id, baseRevision);
      return this.saveNext(id, this.get(id, revision), "restore", {
        fromRevision: revision,
      });
    });
  }
  travel(id: string, baseRevision: number, action: "undo" | "redo") {
    return this.transaction(() => {
      this.checkBase(id, baseRevision);
      const row = this.row(id),
        undo: number[] = JSON.parse(row.undo_stack),
        redo: number[] = JSON.parse(row.redo_stack);
      const from = action === "undo" ? undo : redo,
        to = action === "undo" ? redo : undo,
        target = from.pop();
      if (target === undefined)
        throw new DomainError(
          "HISTORY_EMPTY",
          action === "undo" ? "没有可撤销的操作" : "没有可重做的操作",
          422,
        );
      to.push(row.current_revision);
      return this.saveNext(
        id,
        this.get(id, target),
        action,
        { fromRevision: target },
        { undo, redo },
      );
    });
  }
  recordExport(
    id: string,
    revision: number,
    format: string,
    file: Uint8Array | string,
    options: unknown = {},
  ) {
    this.db
      .prepare(
        "INSERT INTO exports(pattern_id,revision,format,data_digest,file_digest,created_at,options) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        revision,
        format,
        this.revisionRow(id, revision).digest,
        createHash("sha256").update(file).digest("hex"),
        new Date().toISOString(),
        JSON.stringify(options),
      );
  }
  delete(id: string) {
    this.row(id);
    this.db.prepare("DELETE FROM patterns WHERE id=?").run(id);
  }
}
