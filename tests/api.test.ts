import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { buildApp } from "../apps/api/src/app";
import { PatternStore } from "../apps/api/src/store";
import { createSmallDemo } from "../packages/core/src/demo";
import { calculateStats } from "../packages/core/src/index";
import type { EditRequest } from "../packages/core/src/types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let store: PatternStore, app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  store = new PatternStore(":memory:");
  app = await buildApp({ store, seed: false });
  await app.inject({
    method: "POST",
    url: "/api/v1/patterns",
    payload: createSmallDemo(),
  });
});
afterEach(async () => {
  await app.close();
  store.close();
});
const edit = (baseRevision = 1): EditRequest => ({
  baseRevision,
  operations: [
    { type: "set_cell", x: 1, y: 1, expectedColor: "C01", newColor: "C02" },
  ],
});
const route = "/api/v1/patterns/demo-001";
describe("REST API integration and revision persistence", () => {
  it("supports explicitly enabled public access without a login or cookie", async () => {
    const publicApp = await buildApp({ store, seed: false, token: "unused-reserved-token", publicAccess: true, publicOrigin: "https://perler.cloud" });
    try {
      expect((await publicApp.inject("/api/v1/config")).json()).toMatchObject({ authRequired: false, mode: "public" });
      const headers = { host: "perler.cloud", origin: "https://perler.cloud" };
      expect((await publicApp.inject({ url: route, headers })).statusCode).toBe(200);
      expect((await publicApp.inject({ method: "POST", url: route + "/edits/commit", headers, payload: edit() })).statusCode).toBe(200);
      expect((await publicApp.inject({ url: route, headers: { host: "perler.cloud", origin: "https://wrong.example" } })).statusCode).toBe(403);
    } finally { await publicApp.close(); }
  });
  it("imports canonical revision 1 and preserves exact raw JSON", async () => {
    const p = createSmallDemo();
    p.patternId = "raw-example";
    p.revision = 7;
    const raw = JSON.stringify(p, null, 4);
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/patterns",
      payload: { pattern: p, rawJson: raw },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().pattern.revision).toBe(1);
    const archive = r.json().archives[0];
    const file = await app.inject(
      `/api/v1/patterns/raw-example/archives/${archive.id}`,
    );
    expect(file.body).toBe(raw);
  });
  it("previews without mutation and commits one changed cell as revision 2", async () => {
    const preview = await app.inject({
      method: "POST",
      url: route + "/edits/preview",
      payload: edit(),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().changedCells).toBe(1);
    expect(store.get("demo-001").revision).toBe(1);
    const committed = await app.inject({
      method: "POST",
      url: route + "/edits/commit",
      payload: edit(),
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().pattern.revision).toBe(2);
    expect(calculateStats(committed.json().pattern).beadCount).toBe(5);
    expect(store.history("demo-001")[0].changedCells).toBe(1);
  });
  it("rejects concurrent stale revision 3 request after revision 4 commits", async () => {
    store.commit("demo-001", edit());
    store.commit("demo-001", {
      baseRevision: 2,
      operations: [{ type: "set_cell", x: 2, y: 1, newColor: "C02" }],
    });
    const a = {
      baseRevision: 3,
      operations: [{ type: "set_cell", x: 1, y: 2, newColor: null }],
    };
    const b = {
      baseRevision: 3,
      operations: [{ type: "set_cell", x: 2, y: 2, newColor: null }],
    };
    const responses = await Promise.all([
      app.inject({ method: "POST", url: route + "/edits/commit", payload: a }),
      app.inject({ method: "POST", url: route + "/edits/commit", payload: b }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(store.get("demo-001").revision).toBe(4);
    expect(
      responses.find((r) => r.statusCode === 409)!.json().error.details
        .currentRevision,
    ).toBe(4);
  });
  it("rolls back an entire invalid batch and rejects unknown fields", async () => {
    const request = {
      baseRevision: 1,
      operations: [
        { type: "set_cell", x: 1, y: 1, newColor: null },
        { type: "set_cell", x: 1, y: 2, expectedColor: "C01", newColor: null },
      ],
    };
    const r = await app.inject({
      method: "POST",
      url: route + "/edits/commit",
      payload: request,
    });
    expect(r.statusCode).toBe(409);
    expect(store.get("demo-001")).toEqual(createSmallDemo());
    expect(store.history("demo-001")).toHaveLength(1);
    const invalid = await app.inject({
      method: "POST",
      url: route + "/edits/commit",
      payload: { ...edit(), force: true },
    });
    expect(invalid.statusCode).toBe(422);
  });
  it("returns consistent errors for null, absent, unknown and malformed requests", async () => {
    for (const payload of [
      null,
      {},
      { baseRevision: 1, operations: [{ type: "__proto__", newColor: null }] },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: route + "/edits/commit",
        payload: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });
      expect(r.statusCode).toBeLessThan(500);
      expect(r.json().error.code).toBeTruthy();
    }
    const bad = await app.inject("/api/v1/patterns/absent");
    expect(bad.statusCode).toBe(404);
  });
  it("deduplicates retries, even when the original baseRevision is stale", async () => {
    const request = { ...edit(), idempotencyKey: "same-key" };
    const first = await app.inject({
      method: "POST",
      url: route + "/edits/commit",
      payload: request,
    });
    const retry = await app.inject({
      method: "POST",
      url: route + "/edits/commit",
      payload: request,
    });
    expect(retry.json()).toEqual(first.json());
    expect(store.history("demo-001")).toHaveLength(2);
    const conflict = await app.inject({
      method: "POST",
      url: route + "/edits/commit",
      payload: {
        ...request,
        operations: [{ type: "set_cell", x: 2, y: 1, newColor: null }],
      },
    });
    expect(conflict.statusCode).toBe(409);
  });
  it("restores old content into a new revision and keeps all old versions", async () => {
    store.commit("demo-001", edit());
    const r = await app.inject({
      method: "POST",
      url: route + "/revisions/1/restore",
      payload: { baseRevision: 2 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pattern.revision).toBe(3);
    expect(r.json().pattern.grid.cells).toEqual(createSmallDemo().grid.cells);
    expect(store.history("demo-001")).toHaveLength(3);
    expect(store.get("demo-001", 2).grid.cells[0][0]).toBe("C02");
    expect((await app.inject(route + "/stats")).json().colors[0].count).toBe(3);
  });
  it("persists undo/redo stacks across closing and reopening SQLite", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "bead-store-")),
      "test.sqlite",
    );
    let disk = new PatternStore(path);
    disk.create(createSmallDemo());
    disk.commit("demo-001", edit());
    disk.close();
    disk = new PatternStore(path);
    expect(disk.state("demo-001").canUndo).toBe(true);
    const undone = disk.travel("demo-001", 2, "undo");
    expect(undone.pattern.revision).toBe(3);
    expect(undone.pattern.grid.cells[0][0]).toBe("C01");
    disk.close();
    disk = new PatternStore(path);
    expect(disk.state("demo-001").canRedo).toBe(true);
    const redone = disk.travel("demo-001", 3, "redo");
    expect(redone.pattern.revision).toBe(4);
    expect(redone.pattern.grid.cells[0][0]).toBe("C02");
    expect(disk.history("demo-001")).toHaveLength(4);
    disk.close();
  });
  it("layout commits leave every cell unchanged and bind palettes only explicitly", async () => {
    const p = store.get("demo-001"),
      layout = structuredClone(p.layout);
    layout.board.width = 50;
    const r = await app.inject({
      method: "PUT",
      url: route + "/layout",
      payload: { baseRevision: 1, layout },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().pattern.grid.cells).toEqual(p.grid.cells);
    expect(store.history("demo-001")[0].changedCells).toBe(0);
    const palette = {
      id: "bad",
      version: "v1",
      colors: { WHITE: { name: "white", hex: "#FFFFFF" } },
    };
    const failed = await app.inject({
      method: "PUT",
      url: route + "/palette",
      payload: { baseRevision: 2, palette },
    });
    expect(failed.statusCode).toBe(422);
    expect(store.get("demo-001").palette).toEqual(p.palette);
  });
  it("archives untrusted SVG as a download, without executing or rendering it", async () => {
    const p = createSmallDemo();
    p.patternId = "archived";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/patterns",
      payload: {
        pattern: p,
        originals: [
          {
            name: "../../unsafe.svg",
            format: "svg",
            base64: Buffer.from(svg).toString("base64"),
          },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    const file = await app.inject(
      "/api/v1/patterns/archived/archives/" + r.json().archives[1].id,
    );
    expect(file.headers["content-type"]).toContain("application/octet-stream");
    expect(file.headers["content-disposition"]).toContain("attachment");
    expect(file.headers["content-security-policy"]).toContain("sandbox");
    expect(file.body).toBe(svg);
  });
  it("rejects hostile origins and hostnames in unauthenticated loopback mode", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: route + "/edits/commit",
          payload: edit(),
          headers: { origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: route, headers: { host: "evil.example" } }))
        .statusCode,
    ).toBe(403);
  });
  it("requires token in authenticated mode and uses HttpOnly session cookies", async () => {
    const protectedApp = await buildApp({
      store,
      seed: false,
      token: "test-secret-token",
      publicOrigin: "https://beads.example",
    });
    try {
      expect((await protectedApp.inject(route)).statusCode).toBe(401);
      expect(
        (
          await protectedApp.inject({
            url: route,
            headers: { authorization: "Bearer test-secret-token" },
          })
        ).statusCode,
      ).toBe(200);
      const login = await protectedApp.inject({
        method: "POST",
        url: "/api/v1/session/login",
        payload: { token: "test-secret-token" },
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
      expect(login.headers["set-cookie"]).toContain("Secure");
      const cookie = String(login.headers["set-cookie"]).split(";")[0];
      expect(
        (await protectedApp.inject({ url: route, headers: { cookie } }))
          .statusCode,
      ).toBe(200);
      const wrong = await protectedApp.inject({
        method: "POST",
        url: "/api/v1/session/login",
        payload: { token: "中文中文中文中文中文中文中文字" },
      });
      expect(wrong.statusCode).toBe(401);
    } finally {
      await protectedApp.close();
    }
  });
  it("serves real schema, OpenAPI paths, verified MARD palette and revision stats", async () => {
    const doc = (await app.inject("/api/v1/openapi.json")).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/patterns/{id}/edits/commit"]).toBeTruthy();
    const palette = (await app.inject("/api/v1/palettes")).json()[0];
    expect(Object.keys(palette.palette.colors)).toHaveLength(221);
    expect(palette.palette.colors.A1.hex).toBe("#FAF4C8");
    expect(palette.source.range).toBe("A2:B222");
    expect((await app.inject(route + "/stats?format=csv")).body).toContain(
      "C01",
    );
  });
});
