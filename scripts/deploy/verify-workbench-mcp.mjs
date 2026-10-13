import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.argv[2] ?? "https://perler.cloud";
const exerciseWrites = process.argv.includes("--exercise-writes");
const client = new Client({
  name: "workbench-production-verifier",
  version: "2.0.0",
});
const checks = [];
const probeId = "mcp-verification-" + randomUUID();
const created = new Set();
let initialProjects;
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, `${name}: tool execution failed`);
  return result.structuredContent;
}
async function approved(name, args) {
  const preview = await call(name, args);
  assert.equal(preview.status, "preview");
  assert(preview.confirmationToken && preview.requiresUserConfirmation);
  return call(name, { ...args, confirmationToken: preview.confirmationToken });
}
async function download(url, contentType) {
  const target = new URL(url);
  assert.equal(target.origin, "https://perler.cloud");
  // Staging checks use the same path on the explicit loopback verification host.
  const response = await fetch(
    new URL(target.pathname + target.search, origin),
    { signal: AbortSignal.timeout(60000) },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), contentType);
  return response;
}
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin)),
  );
  const { tools } = await client.listTools();
  assert.equal(tools.length, 26);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 26);
  assert.equal(
    tools.find((t) => t.name === "commit_pattern_edit").annotations
      .readOnlyHint,
    false,
  );
  assert.equal(
    tools.find((t) => t.name === "delete_pattern").annotations.destructiveHint,
    true,
  );
  checks.push("official SDK initialize and 26-tool discovery");
  const info = await call("get_workbench_info");
  assert.equal(info.schemaVersion, "1.0");
  const listed = await call("list_patterns", { limit: 100 });
  initialProjects = listed.total;
  const palette = (await call("list_palettes")).palettes[0];
  assert.equal(Object.keys(palette.colors).length, 221);
  if (listed.items.length) {
    const id = listed.items[0].id;
    const full = await call("get_pattern", { patternId: id });
    assert.equal(full.pattern.grid.cells.length, full.pattern.grid.height);
    assert.equal(full.pattern.grid.cells[0].length, full.pattern.grid.width);
    await call("get_pattern_stats", { patternId: id });
    await call("get_pattern_revisions", { patternId: id });
    await call("list_pattern_archives", { patternId: id });
  }
  checks.push(
    "full JSON, schema, real workspace, MARD palette, stats and history",
  );
  if (exerciseWrites) {
    // Never edit any pre-existing pattern. Every target is our unique probe ID.
    const newArgs = {
      patternId: probeId,
      title: "MCP 部署验收（临时）",
      width: 3,
      height: 2,
    };
    const preview = await call("create_pattern", newArgs);
    assert.equal((await call("list_patterns")).total, initialProjects);
    created.add(probeId);
    await call("create_pattern", {
      ...newArgs,
      confirmationToken: preview.confirmationToken,
    });
    const request = {
      baseRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { type: "set_cell", x: 1, y: 1, newColor: "A1" },
        { type: "set_cell", x: 2, y: 1, newColor: "H2" },
        { type: "set_cell", x: 3, y: 2, newColor: "H6" },
      ],
    };
    const editPreview = await call("preview_pattern_edit", {
      patternId: probeId,
      request,
    });
    assert.equal(editPreview.preview.changedCells, 3);
    const editArgs = {
      patternId: probeId,
      request,
      confirmationToken: editPreview.confirmationToken,
    };
    const edited = await call("commit_pattern_edit", editArgs);
    assert.equal(edited.revision, 2);
    assert.deepEqual(await call("commit_pattern_edit", editArgs), edited);
    const full = await call("get_pattern", { patternId: probeId });
    assert.equal(full.pattern.grid.cells[0][0], "A1");
    const region = await call("get_pattern_region", {
      patternId: probeId,
      range: { x1: 1, y1: 1, x2: 2, y2: 1 },
    });
    assert.deepEqual(region.cells, [["A1", "H2"]]);
    const csv = await call("get_pattern_stats", {
      patternId: probeId,
      revision: 2,
      format: "csv",
    });
    assert.equal(csv.stats.beadCount, 3);
    assert(csv.csv.includes("A1"));
    assert(
      (await (await download(csv.downloadUrl, /text\/csv/)).text()).includes(
        "A1",
      ),
    );
    checks.push(
      "non-persisting create/edit preview, confirmation, idempotency, region and CSV",
    );
    const layout = structuredClone(full.pattern.layout);
    layout.showColorCodes = true;
    layout.board.showLabels = true;
    await approved("update_pattern_layout", {
      patternId: probeId,
      baseRevision: 2,
      layout,
    });
    const changedPalette = structuredClone(palette);
    changedPalette.version = "mcp-verification-only";
    await approved("bind_pattern_palette", {
      patternId: probeId,
      baseRevision: 3,
      palette: changedPalette,
    });
    await approved("undo_pattern_edit", {
      patternId: probeId,
      baseRevision: 4,
    });
    await approved("redo_pattern_edit", {
      patternId: probeId,
      baseRevision: 5,
    });
    await approved("restore_pattern_revision", {
      patternId: probeId,
      baseRevision: 6,
      revision: 1,
    });
    assert.equal(
      (await call("get_pattern", { patternId: probeId })).pattern.revision,
      7,
    );
    assert.equal(
      (
        await call("diff_pattern_revisions", {
          patternId: probeId,
          from: 1,
          to: 2,
        })
      ).total,
      3,
    );
    checks.push(
      "layout, palette, undo/redo, immutable revisions, restore and diff",
    );
    for (const format of ["svg", "pdf", "json"]) {
      const output = await call(`export_pattern_${format}`, {
        patternId: probeId,
        revision: 2,
      });
      const response = await download(
        output.downloadUrl,
        format === "svg"
          ? /image\/svg\+xml/
          : format === "pdf"
            ? /application\/pdf/
            : /application\/json/,
      );
      assert.equal(response.headers.get("x-pattern-revision"), "2");
      if (format === "svg")
        assert.equal(
          ((await response.text()).match(/id="bead-/g) ?? []).length,
          3,
        );
      if (format === "pdf")
        assert.equal(
          Buffer.from(await response.arrayBuffer())
            .subarray(0, 5)
            .toString(),
          "%PDF-",
        );
      if (format === "json")
        assert.equal((await response.json()).grid.cells[0][0], "A1");
    }
    assert.equal(
      (await call("get_pattern_export_records", { patternId: probeId })).total,
      3,
    );
    const archive = (
      await call("list_pattern_archives", { patternId: probeId })
    ).archives[0];
    const archived = await call("get_pattern_archive", {
      patternId: probeId,
      archiveId: archive.id,
    });
    assert.equal(
      (
        await (
          await download(archived.downloadUrl, /application\/octet-stream/)
        ).json()
      ).patternId,
      probeId,
    );
    checks.push(
      "revision-pinned SVG/PDF/JSON downloads, original archive and export audit",
    );
    const legacyId = probeId + "-legacy";
    const legacy = {
      schema_version: 1,
      name: "MCP 旧版导入验收（临时）",
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
      palette: { A1: { hex: palette.colors.A1.hex } },
      grid: [["A1"]],
    };
    created.add(legacyId);
    await approved("import_pattern", {
      rawJson: JSON.stringify(legacy),
      patternId: legacyId,
      paletteMode: "mard221",
    });
    assert.equal(
      (await call("get_pattern", { patternId: legacyId })).pattern.grid
        .cells[0][0],
      "A1",
    );
    checks.push("legacy import through the same validated archive service");
  }
} finally {
  try {
    for (const id of created) {
      assert(id.startsWith(probeId));
      const existence = await fetch(new URL(`/api/v1/patterns/${id}`, origin));
      if (existence.status === 404) continue;
      assert.equal(existence.status, 200);
      const state = await call("get_pattern", { patternId: id });
      await approved("delete_pattern", {
        patternId: id,
        baseRevision: state.pattern.revision,
      });
    }
    if (initialProjects !== undefined)
      assert.equal((await call("list_patterns")).total, initialProjects);
    if (exerciseWrites)
      checks.push(
        "confirmed deletion of own probes; original project count preserved",
      );
  } finally {
    await client.close();
  }
}
console.log(
  JSON.stringify({
    endpoint: new URL("/mcp", origin).href,
    verifiedAt: new Date().toISOString(),
    toolCount: 26,
    writesExercised: exerciseWrites,
    initialProjects,
    checks,
  }),
);
