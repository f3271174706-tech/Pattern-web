import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildApp } from "../apps/api/src/app";
import { PatternStore } from "../apps/api/src/store";
import { createMardSmallDemo } from "../packages/core/src/mard-demo";
import { createSmallDemo } from "../packages/core/src/demo";
import type { EditRequest } from "../packages/core/src/types";
import { workbenchToolDefinitions } from "../apps/api/src/workbench-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
let store: PatternStore, app: Awaited<ReturnType<typeof buildApp>>;
const patternId = "mard-demo-3x2";
const headers = {
  host: "perler.cloud",
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  "mcp-protocol-version": "2025-11-25",
};
beforeEach(async () => {
  store = new PatternStore(":memory:");
  store.create(createMardSmallDemo());
  app = await buildApp({
    store,
    seed: false,
    publicAccess: true,
    publicOrigin: "https://perler.cloud",
    token: "IGNORED_PRIVATE_TOKEN",
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  store.close();
});
const rpc = async (name: string, args: Record<string, unknown> = {}) => {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  expect(response.statusCode).toBe(200);
  return response.json().result;
};
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await rpc(name, args);
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result.structuredContent;
};
const confirm = async (name: string, args: Record<string, unknown>) => {
  const preview = await call(name, args);
  expect(preview.status).toBe("preview");
  return call(name, { ...args, confirmationToken: preview.confirmationToken });
};
const edit: EditRequest = {
  baseRevision: 1,
  idempotencyKey: "mcp-edit-one",
  operations: [
    { type: "set_cell", x: 1, y: 1, expectedColor: "A1", newColor: "H2" },
  ],
};
const snapshot = () =>
  JSON.stringify(
    ["patterns", "revisions", "archives", "idempotency", "exports"].map(
      (table) => store.db.prepare("SELECT * FROM " + table).all(),
    ),
  );

it("advertises all 26 tools with accurate read/write and destructive annotations", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const tools = response.json().result.tools;
  expect(tools).toHaveLength(26);
  expect(new Set(tools.map((t: { name: string }) => t.name)).size).toBe(26);
  expect(
    tools.find((t: { name: string }) => t.name === "commit_pattern_edit")
      .annotations,
  ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect(
    tools.find((t: { name: string }) => t.name === "delete_pattern")
      .annotations,
  ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect(
    tools.find((t: { name: string }) => t.name === "create_pattern")
      .annotations,
  ).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  for (const definition of workbenchToolDefinitions)
    expect(
      tools.some((t: { name: string }) => t.name === definition.name),
    ).toBe(true);
});
it("returns full JSON, exact regions, stats/CSV, schema, palettes, history, diff, archives and audit without writes", async () => {
  const before = snapshot();
  expect((await call("list_patterns")).items).toHaveLength(1);
  const info = await call("get_workbench_info");
  expect(info.patternSchema.properties.grid).toBeDefined();
  expect(info.editSchema.properties.operations).toBeDefined();
  const full = await call("get_pattern", { patternId });
  expect(full.pattern).toEqual(store.get(patternId));
  expect(full.canUndo).toBe(false);
  const region = await call("get_pattern_region", {
    patternId,
    range: { x1: 1, y1: 1, x2: 2, y2: 1 },
  });
  expect(region.cells).toEqual([
    store.get(patternId).grid.cells[0].slice(0, 2),
  ]);
  const stats = await call("get_pattern_stats", { patternId, format: "csv" });
  expect(stats.stats.beadCount).toBe(5);
  expect(stats.csv).toContain("A1");
  expect(stats.downloadUrl).toContain("revision=1");
  expect(
    (
      await call("get_pattern_stats", {
        patternId,
        range: { x1: 1, y1: 1, x2: 1, y2: 1 },
      })
    ).stats.beadCount,
  ).toBe(1);
  const palettes = await call("list_palettes");
  expect(Object.keys(palettes.palettes[0].colors)).toHaveLength(221);
  expect((await call("list_palettes", { patternId })).palettes[0]).toEqual(
    store.get(patternId).palette,
  );
  expect(
    (await call("get_pattern_revisions", { patternId })).items,
  ).toHaveLength(1);
  expect(
    (await call("diff_pattern_revisions", { patternId, from: 1, to: 1 })).total,
  ).toBe(0);
  const archives = await call("list_pattern_archives", { patternId });
  expect(archives.archives).toHaveLength(1);
  const original = await call("get_pattern_archive", {
    patternId,
    archiveId: archives.archives[0].id,
  });
  expect(original.downloadUrl).toMatch(/\/archives\/\d+$/);
  expect(original.archive.content).toBeUndefined();
  expect((await call("get_pattern_export_records", { patternId })).total).toBe(
    0,
  );
  expect(snapshot()).toBe(before);
  expect(JSON.stringify(info)).not.toContain("IGNORED_PRIVATE_TOKEN");
});
it("requires a matching edit preview, rejects tampering, commits atomically and deduplicates retries", async () => {
  expect(
    (await rpc("commit_pattern_edit", { patternId, request: edit })).isError,
  ).toBe(true);
  const before = snapshot(),
    preview = await call("preview_pattern_edit", { patternId, request: edit });
  expect(preview.preview.changedCells).toBe(1);
  expect(snapshot()).toBe(before);
  const changed = {
    ...edit,
    operations: [{ type: "set_cell", x: 1, y: 1, newColor: "G7" }],
  };
  expect(
    (
      await rpc("commit_pattern_edit", {
        patternId,
        request: changed,
        confirmationToken: preview.confirmationToken,
      })
    ).isError,
  ).toBe(true);
  const args = {
    patternId,
    request: edit,
    confirmationToken: preview.confirmationToken,
  };
  const committed = await call("commit_pattern_edit", args);
  expect(committed.revision).toBe(2);
  expect(store.get(patternId).grid.cells[0][0]).toBe("H2");
  expect(await call("commit_pattern_edit", args)).toEqual(committed);
  expect(store.get(patternId).revision).toBe(2);
  const prior = await call("get_pattern", { patternId, revision: 1 });
  expect(prior.pattern.grid.cells[0][0]).toBe("A1");
  expect(prior.isCurrent).toBe(false);
});
it("rejects stale previews and keeps unrelated cells intact", async () => {
  const preview = await call("preview_pattern_edit", {
    patternId,
    request: edit,
  });
  store.commit(patternId, {
    baseRevision: 1,
    operations: [{ type: "set_cell", x: 2, y: 1, newColor: "G7" }],
  });
  const result = await rpc("commit_pattern_edit", {
    patternId,
    request: edit,
    confirmationToken: preview.confirmationToken,
  });
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text).error.code).toBe(
    "REVISION_CONFLICT",
  );
  expect(store.get(patternId).grid.cells[0][0]).toBe("A1");
  expect(store.get(patternId).grid.cells[0][1]).toBe("G7");
});
it("expires confirmation tokens and binds them to action and arguments", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const args = {
    patternId,
    baseRevision: 1,
    layout: { ...store.get(patternId).layout, showColorCodes: true },
  };
  const preview = await call("update_pattern_layout", args);
  expect(preview.preview.layoutChanged).toBe(true);
  expect(preview.preview.layoutBefore.showColorCodes).not.toBe(true);
  expect(preview.preview.layoutAfter.showColorCodes).toBe(true);
  expect(
    (
      await rpc("delete_pattern", {
        patternId,
        baseRevision: 1,
        confirmationToken: preview.confirmationToken,
      })
    ).isError,
  ).toBe(true);
  vi.setSystemTime(new Date(Date.now() + 301000));
  expect(
    (
      await rpc("update_pattern_layout", {
        ...args,
        confirmationToken: preview.confirmationToken,
      })
    ).isError,
  ).toBe(true);
  expect(store.get(patternId).revision).toBe(1);
});
it.each([
  { operations: [{ type: "replace_color", oldColor: "A1", newColor: "H2" }] },
  {
    operations: [
      {
        type: "replace_color_in_rect",
        rect: { x1: 1, y1: 1, x2: 2, y2: 1 },
        oldColor: "A1",
        newColor: "H2",
      },
    ],
  },
  {
    operations: [
      {
        type: "fill_rect",
        rect: { x1: 1, y1: 1, x2: 2, y2: 1 },
        newColor: "H2",
      },
    ],
  },
])(
  "supports bulk operation %j through preview and commit",
  async ({ operations }) => {
    const request = { baseRevision: 1, operations };
    const preview = await call("preview_pattern_edit", { patternId, request });
    const committed = await call("commit_pattern_edit", {
      patternId,
      request,
      confirmationToken: preview.confirmationToken,
    });
    expect(committed.revision).toBe(2);
    expect(store.get(patternId).grid.cells[0][0]).toBe("H2");
  },
);
it("creates a blank pattern only after confirmation and retries without duplicates", async () => {
  const args = { title: "MCP 空白图", width: 4, height: 3 };
  const before = snapshot(),
    preview = await call("create_pattern", args);
  expect(snapshot()).toBe(before);
  expect(preview.preview).toMatchObject({
    width: 4,
    height: 3,
    beadCount: 0,
    revision: 1,
  });
  const actualArgs = { ...args, confirmationToken: preview.confirmationToken };
  const created = await call("create_pattern", actualArgs);
  expect(store.get(created.patternId).grid.cells).toEqual(
    Array.from({ length: 3 }, () => Array(4).fill(null)),
  );
  expect(await call("create_pattern", actualArgs)).toEqual(created);
  expect(store.list()).toHaveLength(2);
});
it("imports v1 revision 7 and archives original JSON without rewriting it", async () => {
  const p = createSmallDemo();
  p.patternId = "import-rev7";
  p.revision = 7;
  const rawJson = JSON.stringify(p, null, 2),
    created = await confirm("import_pattern", { rawJson });
  expect(created.revision).toBe(1);
  expect(store.get(p.patternId).grid.cells).toEqual(p.grid.cells);
  const original = store.db
    .prepare(
      "SELECT content FROM archives WHERE pattern_id=? AND format='json'",
    )
    .get(p.patternId)!;
  expect(Buffer.from(original.content as Uint8Array).toString()).toBe(rawJson);
});
it("imports legacy grid JSON with source/MARD selection and preserves attached SVG", async () => {
  const legacy = {
    schema_version: 1,
    name: "旧版图",
    width: 1,
    height: 1,
    palette_system: "MARD 221",
    orientation: "front",
    coordinate_system: {
      origin: "top-left",
      index_base: 0,
      grid_access: "grid[y][x]",
    },
    empty_cell: null,
    palette: { A1: { hex: "#010203" } },
    grid: [["A1"]],
  };
  const rawJson = JSON.stringify(legacy);
  const args = {
    rawJson,
    patternId: "legacy-mcp",
    paletteMode: "mard221",
    originals: [
      {
        name: "原图.svg",
        format: "svg",
        base64: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"/>',
        ).toString("base64"),
      },
    ],
  };
  const preview = await call("import_pattern", args);
  expect(preview.preview.paletteConflicts).toHaveLength(1);
  await call("import_pattern", {
    ...args,
    confirmationToken: preview.confirmationToken,
  });
  expect(store.get("legacy-mcp").palette.colors.A1.hex).not.toBe("#010203");
  expect(store.archives("legacy-mcp")).toHaveLength(2);
  await confirm("import_pattern", {
    rawJson,
    patternId: "legacy-source",
    paletteMode: "source",
  });
  expect(store.get("legacy-source").palette.colors.A1.hex).toBe("#010203");
});
it("changes layout and palette only after preview, preserves cells and supports undo/redo/restore", async () => {
  const initial = store.get(patternId),
    layout = {
      ...initial.layout,
      showColorCodes: true,
      board: { ...initial.layout.board, showLabels: true },
    };
  await confirm("update_pattern_layout", {
    patternId,
    baseRevision: 1,
    layout,
  });
  expect(store.get(patternId).layout).toEqual(layout);
  expect(store.get(patternId).grid.cells).toEqual(initial.grid.cells);
  await confirm("undo_pattern_edit", { patternId, baseRevision: 2 });
  expect(store.get(patternId).layout).toEqual(initial.layout);
  await confirm("redo_pattern_edit", { patternId, baseRevision: 3 });
  expect(store.get(patternId).layout).toEqual(layout);
  const palette = structuredClone(initial.palette);
  palette.version = "custom-preview-version";
  await confirm("bind_pattern_palette", {
    patternId,
    baseRevision: 4,
    palette,
  });
  expect(store.get(patternId).palette.version).toBe(palette.version);
  await confirm("restore_pattern_revision", {
    patternId,
    baseRevision: 5,
    revision: 1,
  });
  expect(store.get(patternId).revision).toBe(6);
  expect(store.get(patternId).palette.version).toBe(initial.palette.version);
  await confirm("bind_pattern_palette", {
    patternId,
    baseRevision: 6,
    paletteId: "MARD-221",
  });
  expect(store.get(patternId).revision).toBe(7);
});
it("requires a deletion preview, removes only the selected pattern and replays safely", async () => {
  const second = createSmallDemo();
  store.create(second);
  const args = { patternId, baseRevision: 1 },
    before = snapshot();
  const preview = await call("delete_pattern", args);
  expect(snapshot()).toBe(before);
  expect(preview.preview.deletesHistory).toBe(true);
  const confirmed = { ...args, confirmationToken: preview.confirmationToken };
  const deleted = await call("delete_pattern", confirmed);
  expect(deleted.deleted).toBe(true);
  expect(await call("delete_pattern", confirmed)).toEqual(deleted);
  expect(store.list().map((p) => p.id)).toEqual([second.patternId]);
});
it.each(["svg", "pdf", "json"])(
  "exports %s via existing revision-pinned API without mutating the graph",
  async (format) => {
    const before = JSON.stringify(store.get(patternId)),
      download = await call(`export_pattern_${format}`, {
        patternId,
        revision: 1,
      });
    expect(download.status).toBe("ready_for_download");
    expect(download.downloadUrl).toContain("revision=1");
    const response = await app.inject(
      new URL(download.downloadUrl).pathname +
        new URL(download.downloadUrl).search,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-pattern-revision"]).toBe("1");
    if (format === "svg") expect(response.body).toContain("<svg");
    if (format === "pdf")
      expect(response.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    if (format === "json")
      expect(response.json().grid.cells).toEqual(
        store.get(patternId).grid.cells,
      );
    expect(JSON.stringify(store.get(patternId))).toBe(before);
    expect(
      (await call("get_pattern_export_records", { patternId })).total,
    ).toBe(1);
  },
);
it("handles imports larger than the old 16 KiB MCP ceiling and rejects unknown argument fields", async () => {
  const p = createMardSmallDemo();
  p.patternId = "large-mcp";
  p.grid.width = 100;
  p.grid.height = 100;
  p.grid.cells = Array.from({ length: 100 }, () => Array(100).fill("A1"));
  const args = { rawJson: JSON.stringify(p) };
  expect(Buffer.byteLength(args.rawJson)).toBeGreaterThan(16384);
  await confirm("import_pattern", args);
  expect(store.get("large-mcp").grid.width).toBe(100);
  expect(
    (await rpc("get_pattern", { patternId, serverPath: "/etc/private" }))
      .isError,
  ).toBe(true);
  expect(
    (await rpc("create_pattern", { title: "invalid", width: 501, height: 1 }))
      .isError,
  ).toBe(true);
});
it("does not grant full read or write tools to an unauthenticated client in protected mode", async () => {
  const protectedApp = await buildApp({
    store,
    seed: false,
    token: "TEST_PROTECTED_SECRET",
    publicOrigin: "https://perler.cloud",
  });
  const request = (authorization?: string) =>
    protectedApp.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...headers, ...(authorization ? { authorization } : {}) },
      payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  try {
    expect((await request()).json().result.tools).toHaveLength(2);
    expect((await request("Bearer invalid")).json().result.tools).toHaveLength(
      2,
    );
    const authorized = await request("Bearer TEST_PROTECTED_SECRET");
    expect(authorized.json().result.tools).toHaveLength(26);
    expect(authorized.body).not.toContain("TEST_PROTECTED_SECRET");
    for (const name of [
      "get_pattern",
      "preview_pattern_edit",
      "delete_pattern",
    ]) {
      const response = await protectedApp.inject({
        method: "POST",
        url: "/mcp",
        headers,
        payload: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: { patternId, baseRevision: 1 } },
        }),
      });
      expect(response.json().error.code).toBe(-32602);
    }
    expect(store.get(patternId).revision).toBe(1);
  } finally {
    await protectedApp.close();
  }
});
it("previews changed HEX mappings and blocks invalid palettes, stale deletion and backend errors", async () => {
  const palette = structuredClone(store.get(patternId).palette);
  palette.colors.A1.hex = "#010203";
  const preview = await call("bind_pattern_palette", {
    patternId,
    baseRevision: 1,
    palette,
  });
  expect(preview.preview.paletteMappingsChanged).toBe(1);
  expect(preview.preview.paletteChanges[0]).toMatchObject({
    code: "A1",
    after: { hex: "#010203" },
  });
  const invalid = {
    id: "invalid",
    version: "1",
    colors: { X: { name: "X", hex: "#000000" } },
  };
  expect(
    (
      await rpc("bind_pattern_palette", {
        patternId,
        baseRevision: 1,
        palette: invalid,
      })
    ).isError,
  ).toBe(true);
  const deletion = await call("delete_pattern", { patternId, baseRevision: 1 });
  store.commit(patternId, edit);
  expect(
    (
      await rpc("delete_pattern", {
        patternId,
        baseRevision: 1,
        confirmationToken: deletion.confirmationToken,
      })
    ).isError,
  ).toBe(true);
  expect(store.get(patternId).revision).toBe(2);
  const pending = await call("create_pattern", {
    title: "失败探针",
    width: 1,
    height: 1,
  });
  const create = vi.spyOn(store, "create").mockImplementation(() => {
    throw new Error("PRIVATE_BACKEND_SENTINEL /etc/secret.env");
  });
  try {
    const failed = await rpc("create_pattern", {
      title: "失败探针",
      width: 1,
      height: 1,
      confirmationToken: pending.confirmationToken,
    });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("PRIVATE_BACKEND_SENTINEL");
    expect(JSON.stringify(failed)).not.toContain("secret.env");
  } finally {
    create.mockRestore();
  }
});
it("supports a full preview/commit/read lifecycle with the official HTTP client", async () => {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new Client({ name: "full-workbench-client", version: "1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + "/mcp")),
    );
    expect((await client.listTools()).tools).toHaveLength(26);
    const preview = await client.callTool({
      name: "preview_pattern_edit",
      arguments: { patternId, request: edit },
    });
    expect(preview.isError).not.toBe(true);
    const token = (preview.structuredContent as { confirmationToken: string })
      .confirmationToken;
    const commit = await client.callTool({
      name: "commit_pattern_edit",
      arguments: { patternId, request: edit, confirmationToken: token },
    });
    expect(commit.isError).not.toBe(true);
    const full = await client.callTool({
      name: "get_pattern",
      arguments: { patternId },
    });
    expect(
      (full.structuredContent as { pattern: { revision: number } }).pattern
        .revision,
    ).toBe(2);
  } finally {
    await client.close();
  }
});
