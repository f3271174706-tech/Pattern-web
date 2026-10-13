import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DomainError,
  calculateStats,
  diffPatterns,
  statsCsv,
  patternSchema,
} from "../../../packages/core/src/index";
import type {
  EditRequest,
  Layout,
  Palette,
  Rect,
} from "../../../packages/core/src/types";
import {
  createMardDemo,
  createMardSmallDemo,
} from "../../../packages/core/src/mard-demo";
import mard from "../../../examples/palettes/mard221.json";
import provenance from "../../../examples/palettes/mard221.source.json";
import { PatternStore, type ArchiveInput } from "./store";
import { exportInWorker } from "./export-worker";
import { openapi, editSchema } from "./openapi";
import type { LegacyImportOptions } from "../../../packages/core/src/import-pattern";
import { createPublicExampleCatalog } from "./public-examples";
import { registerPublicMcp } from "./public-mcp";
import { createWorkbenchMcp } from "./workbench-mcp";
interface Options {
  store?: PatternStore;
  databasePath?: string;
  token?: string;
  publicOrigin?: string;
  publicAccess?: boolean;
  seed?: boolean;
  logger?: boolean;
}
const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
const int = (v: unknown, path: string) => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || Number(n) < 1)
    throw new DomainError("INVALID_INTEGER", "必须为正整数", 422, path);
  return Number(n);
};
export async function buildApp(options: Options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 24 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const store =
    options.store ??
    new PatternStore(
      options.databasePath ??
        fileURLToPath(
          new URL("../../../data/workbench.sqlite", import.meta.url),
        ),
    );
  if (options.publicAccess && !options.publicOrigin?.startsWith("https://"))
    throw new Error("公开访问模式必须配置 HTTPS PUBLIC_ORIGIN");
  const token = options.publicAccess ? undefined : options.token,
    publicOrigin = options.publicOrigin;
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; reset: number }>();
  await app.register(cookie);
  app.addHook("onClose", async () => {
    if (!options.store) store.close();
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin");
    if (!req.url.startsWith("/api/")) return;
    const origin = req.headers.origin;
    const allowed = publicOrigin
      ? [publicOrigin]
      : [`http://${req.headers.host}`];
    const localOrigin =
      origin &&
      !publicOrigin &&
      /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
    if (origin && !allowed.includes(origin) && !localOrigin)
      throw new DomainError("ORIGIN_FORBIDDEN", "请求来源不被允许", 403);
    if (
      !token &&
      !options.publicAccess &&
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
        req.headers.host ?? "",
      )
    )
      throw new DomainError(
        "HOST_FORBIDDEN",
        "本地模式仅接受 loopback 主机名",
        403,
      );
    if (
      ["/api/v1/health", "/api/v1/config", "/api/v1/session/login"].includes(
        req.url.split("?")[0],
      )
    )
      return;
    if (
      ["GET", "HEAD"].includes(req.method) &&
      /^\/api\/v1\/examples(?:\/[^/]+(?:\/preview\.svg)?)?$/.test(
        req.url.split("?")[0],
      )
    )
      return;
    if (!token) return;
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    const session = req.cookies.bead_session,
      expires = session ? sessions.get(session) : undefined;
    if (expires && expires > Date.now()) return;
    if (session) sessions.delete(session);
    if (!bearer || !safeEqual(bearer, token))
      throw new DomainError("UNAUTHORIZED", "请输入 API 访问令牌", 401);
  });
  app.setErrorHandler<FastifyError>((error, req, reply) => {
    if (error instanceof DomainError)
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          path: error.path,
          details: error.details,
        },
      });
    if (error.validation)
      return reply.status(422).send({
        error: {
          code: "INVALID_REQUEST",
          message: error.message,
          path: error.validation[0]?.instancePath ?? "",
          details: error.validation,
        },
      });
    if (error.statusCode && error.statusCode < 500)
      return reply.status(error.statusCode).send({
        error: {
          code: error.code ?? "BAD_REQUEST",
          message: error.message,
          path: "",
        },
      });
    req.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务器处理失败，请查看服务端日志",
        path: "",
      },
    });
  });
  const prefix = "/api/v1";
  app.get(prefix + "/health", () => ({ status: "ok", schemaVersion: "1.0" }));
  app.get(prefix + "/config", () => ({
    authRequired: !!token,
    mode: options.publicAccess
      ? "public"
      : token
        ? "authenticated"
        : "local-loopback",
    maxDimension: 500,
  }));
  app.post<{ Body: { token: string } }>(
    prefix + "/session/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", maxLength: 1024 } },
        },
      },
    },
    async (req, reply) => {
      if (!token) return { authenticated: true };
      const previous = attempts.get(req.ip);
      const bucket =
        previous && previous.reset > Date.now()
          ? previous
          : { count: 0, reset: Date.now() + 60000 };
      bucket.count++;
      attempts.set(req.ip, bucket);
      if (attempts.size > 1000)
        for (const [ip, b] of attempts)
          if (b.reset < Date.now()) attempts.delete(ip);
      if (bucket.count > 10)
        throw new DomainError(
          "LOGIN_RATE_LIMIT",
          "尝试过于频繁，请一分钟后重试",
          429,
        );
      if (!safeEqual(req.body.token, token))
        throw new DomainError("UNAUTHORIZED", "访问令牌无效", 401);
      const session = randomBytes(32).toString("hex");
      sessions.set(session, Date.now() + 3600000);
      for (const [s, expires] of sessions)
        if (expires < Date.now()) sessions.delete(s);
      reply.setCookie("bead_session", session, {
        httpOnly: true,
        sameSite: "strict",
        secure: publicOrigin?.startsWith("https://") ?? false,
        path: "/",
        maxAge: 3600,
      });
      return { authenticated: true };
    },
  );
  app.post(prefix + "/session/logout", (req, reply) => {
    if (req.cookies.bead_session) sessions.delete(req.cookies.bead_session);
    reply.clearCookie("bead_session", { path: "/" });
    return { authenticated: false };
  });
  app.get(prefix + "/openapi.json", () => openapi);
  app.get(prefix + "/schema.json", () => patternSchema);
  app.get(prefix + "/palettes", () => [{ palette: mard, source: provenance }]);
  const exampleOrigin =
    publicOrigin || `http://127.0.0.1:${process.env.PORT || 3001}`;
  const examples = createPublicExampleCatalog(exampleOrigin, store);
  app.get(prefix + "/examples", (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { examples: examples.list() };
  });
  app.get<{ Params: { id: string } }>(
    prefix + "/examples/:id",
    (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const example = examples.get(req.params.id);
      return (
        example ??
        reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "图纸不存在",
            path: "/id",
          },
        })
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    prefix + "/examples/:id/preview.svg",
    (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const preview = examples.preview(req.params.id);
      return preview
        ? reply.type("image/svg+xml; charset=utf-8").send(preview)
        : reply.code(404).send({
            error: {
              code: "NOT_FOUND",
              message: "图纸不存在",
              path: "/id",
            },
          });
    },
  );
  await registerPublicMcp(
    app,
    examples,
    exampleOrigin,
    createWorkbenchMcp(store, exampleOrigin, (req) => {
      if (!token) return true;
      const bearer = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "";
      return !!bearer && safeEqual(bearer, token);
    }),
  );
  app.get(prefix + "/patterns", () => store.list());
  app.post<{ Body: unknown }>(prefix + "/patterns", async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== "object")
      throw new DomainError("INVALID_PATTERN", "需要 JSON 图纸对象", 422);
    let result;
    if ("pattern" in body) {
      if (
        Object.keys(body).some(
          (k) =>
            !["pattern", "originals", "rawJson", "importOptions"].includes(k),
        )
      )
        throw new DomainError("INVALID_REQUEST", "导入请求含未知字段", 422);
      const wrapper = body as {
        pattern: unknown;
        originals?: ArchiveInput[];
        rawJson?: string;
        importOptions?: LegacyImportOptions;
      };
      if (
        (wrapper.originals !== undefined &&
          !Array.isArray(wrapper.originals)) ||
        (wrapper.rawJson !== undefined && typeof wrapper.rawJson !== "string")
      )
        throw new DomainError(
          "INVALID_REQUEST",
          "originals 或 rawJson 格式无效",
          422,
        );
      result = store.create(
        wrapper.pattern,
        wrapper.originals,
        wrapper.rawJson,
        wrapper.importOptions,
      );
    } else result = store.create(body);
    return reply.status(201).send({
      ...result,
      archiveNotice:
        result.archives.length > 1
          ? "原始 SVG/PDF 已归档；未验证其与 JSON 的视觉一致性。"
          : undefined,
    });
  });
  type Id = { Params: { id: string } };
  app.get<Id & { Querystring: { revision?: string } }>(
    prefix + "/patterns/:id",
    (req) =>
      req.query.revision
        ? {
            pattern: store.get(
              req.params.id,
              int(req.query.revision, "/revision"),
            ),
            digest: store.revisionRow(
              req.params.id,
              int(req.query.revision, "/revision"),
            ).digest,
          }
        : store.state(req.params.id),
  );
  app.delete<Id>(prefix + "/patterns/:id", (req) => {
    store.delete(req.params.id);
    return { deleted: true };
  });
  app.get<Id & { Querystring: { revision?: string; format?: string } }>(
    prefix + "/patterns/:id/stats",
    (req, reply) => {
      const s = calculateStats(
        store.get(
          req.params.id,
          req.query.revision ? int(req.query.revision, "/revision") : undefined,
        ),
      );
      if (req.query.format === "csv")
        return reply
          .type("text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            `attachment; filename="materials-v${s.revision}.csv"`,
          )
          .send(statsCsv(s));
      return s;
    },
  );
  for (const action of ["preview", "commit"] as const)
    app.post<Id & { Body: EditRequest }>(
      prefix + `/patterns/:id/edits/${action}`,
      { schema: { body: editSchema } },
      (req) =>
        action === "preview"
          ? store.preview(req.params.id, req.body)
          : store.commit(req.params.id, req.body),
    );
  app.get<Id>(prefix + "/patterns/:id/revisions", (req) =>
    store.history(req.params.id),
  );
  type Rev = { Params: { id: string; revision: string } };
  app.get<Rev>(prefix + "/patterns/:id/revisions/:revision", (req) =>
    store.get(req.params.id, int(req.params.revision, "/revision")),
  );
  const baseBody = {
    type: "object",
    additionalProperties: false,
    required: ["baseRevision"],
    properties: { baseRevision: { type: "integer", minimum: 1 } },
  };
  app.post<Rev & { Body: { baseRevision: number } }>(
    prefix + "/patterns/:id/revisions/:revision/restore",
    { schema: { body: baseBody } },
    (req) =>
      store.restore(
        req.params.id,
        int(req.params.revision, "/revision"),
        req.body.baseRevision,
      ),
  );
  for (const action of ["undo", "redo"] as const)
    app.post<Id & { Body: { baseRevision: number } }>(
      prefix + `/patterns/:id/${action}`,
      { schema: { body: baseBody } },
      (req) => store.travel(req.params.id, req.body.baseRevision, action),
    );
  app.put<Id & { Body: { baseRevision: number; layout: Layout } }>(
    prefix + "/patterns/:id/layout",
    {
      schema: {
        body: {
          ...baseBody,
          required: ["baseRevision", "layout"],
          properties: {
            ...baseBody.properties,
            layout: patternSchema.properties.layout,
          },
        },
      },
    },
    (req) =>
      store.updateLayout(req.params.id, req.body.baseRevision, req.body.layout),
  );
  app.put<Id & { Body: { baseRevision: number; palette: Palette } }>(
    prefix + "/patterns/:id/palette",
    {
      schema: {
        body: {
          ...baseBody,
          required: ["baseRevision", "palette"],
          properties: {
            ...baseBody.properties,
            palette: patternSchema.properties.palette,
          },
        },
      },
    },
    (req) =>
      store.bindPalette(req.params.id, req.body.baseRevision, req.body.palette),
  );
  app.get<Id & { Querystring: { from: string; to: string } }>(
    prefix + "/patterns/:id/diff",
    (req) => ({
      from: int(req.query.from, "/from"),
      to: int(req.query.to, "/to"),
      changes: diffPatterns(
        store.get(req.params.id, int(req.query.from, "/from")),
        store.get(req.params.id, int(req.query.to, "/to")),
      ),
    }),
  );
  app.get<Id>(prefix + "/patterns/:id/archives", (req) => {
    store.row(req.params.id);
    return store.archives(req.params.id);
  });
  app.get<{ Params: { id: string; archiveId: string } }>(
    prefix + "/patterns/:id/archives/:archiveId",
    (req, reply) => {
      store.row(req.params.id);
      const row = store.db
        .prepare(
          "SELECT name,content FROM archives WHERE pattern_id=? AND id=?",
        )
        .get(req.params.id, int(req.params.archiveId, "/archiveId")) as
        | { name: string; content: Uint8Array }
        | undefined;
      if (!row)
        throw new DomainError("ARCHIVE_NOT_FOUND", "原始附件不存在", 404);
      return reply
        .type("application/octet-stream")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header(
          "Content-Disposition",
          `attachment; filename="original"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        )
        .send(Buffer.from(row.content));
    },
  );
  app.get<Id>(prefix + "/patterns/:id/export-records", (req) => {
    store.row(req.params.id);
    return store.db
      .prepare("SELECT * FROM exports WHERE pattern_id=? ORDER BY id DESC")
      .all(req.params.id);
  });
  for (const format of ["svg", "pdf", "json"] as const)
    app.get<
      Id & {
        Querystring: {
          revision?: string;
          mode?: string;
          x1?: string;
          y1?: string;
          x2?: string;
          y2?: string;
        };
      }
    >(prefix + `/patterns/:id/exports/${format}`, async (req, reply) => {
      const id = req.params.id,
        p = store.get(
          id,
          req.query.revision ? int(req.query.revision, "/revision") : undefined,
        ),
        digest = store.revisionRow(id, p.revision).digest;
      let range: Rect | undefined;
      if (["x1", "y1", "x2", "y2"].some((k) => k in req.query)) {
        const q = req.query;
        range = {
          x1: int(q.x1, "/x1"),
          y1: int(q.y1, "/y1"),
          x2: int(q.x2, "/x2"),
          y2: int(q.y2, "/y2"),
        };
      }
      if (
        req.query.mode &&
        !["layout", "plain", "grid", "coordinates", "boards"].includes(
          req.query.mode,
        )
      )
        throw new DomainError(
          "INVALID_EXPORT_MODE",
          "SVG 输出模式无效",
          422,
          "/mode",
        );
      const bytes =
        format === "json"
          ? JSON.stringify(p, null, 2)
          : await exportInWorker(p, format, digest, {
              range,
              mode: req.query.mode,
            });
      store.recordExport(id, p.revision, format, bytes, {
        range,
        mode: req.query.mode,
      });
      reply
        .header("X-Pattern-Revision", p.revision)
        .header("X-Pattern-Digest", digest)
        .header("ETag", `"${createHash("sha256").update(bytes).digest("hex")}"`)
        .header(
          "Content-Disposition",
          `attachment; filename="${id}-v${p.revision}.${format}"`,
        );
      return reply
        .type(
          format === "pdf"
            ? "application/pdf"
            : format === "svg"
              ? "image/svg+xml; charset=utf-8"
              : "application/json; charset=utf-8",
        )
        .send(typeof bytes === "string" ? bytes : Buffer.from(bytes));
    });
  if (options.seed !== false && store.list().length === 0) {
    store.create(createMardSmallDemo());
    store.create(createMardDemo());
  }
  const web = fileURLToPath(new URL("../../../dist/web/", import.meta.url));
  if (existsSync(web)) {
    await app.register(fastifyStatic, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.status(404).send({
            error: {
              code: "NOT_FOUND",
              message: "接口不存在",
              path: req.url,
            },
          })
        : reply.sendFile("index.html"),
    );
  } else
    app.setNotFoundHandler((req, reply) =>
      reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "接口不存在；开发网页请访问 5173 端口",
          path: req.url,
        },
      }),
    );
  return app;
}
