import { afterEach, beforeEach, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app";
import { PatternStore } from "../apps/api/src/store";
import { createSmallDemo } from "../packages/core/src/demo";
import { createMardDemo, createMardSmallDemo } from "../packages/core/src/mard-demo";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Fastify from "fastify";
import { registerPublicMcp } from "../apps/api/src/public-mcp";
let store: PatternStore, app: Awaited<ReturnType<typeof buildApp>>;
const headers = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  "mcp-protocol-version": "2025-11-25",
  host: "perler.cloud",
};
beforeEach(async () => {
  store = new PatternStore(":memory:");
  store.create(createMardSmallDemo());
  store.create(createMardDemo());
  const user = createSmallDemo();
  user.patternId = "private-import";
  user.title = "已上传图纸";
  user.source = { producer: "PRIVATE_SOURCE_SENTINEL" };
  store.create(user);
  app = await buildApp({
    store,
    seed: false,
    token: "PRIVATE_TOKEN_SENTINEL",
    publicOrigin: "https://perler.cloud",
  });
});
afterEach(async () => {
  await app.close();
  store.close();
});
const call = (message: unknown, extra = {}) =>
  app.inject({
    method: "POST",
    url: "/mcp",
    headers: { ...headers, ...extra },
    payload: JSON.stringify(message),
  });
const rpc = (method: string, params?: unknown, id: string | number = 0) =>
  call({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
const init = (protocolVersion = "2025-11-25") => ({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
});
it.each(["2025-11-25", "2025-06-18", "2025-03-26", "2099-01-01", "2024-11-05"])(
  "negotiates %s and preserves JSON-RPC id zero without cookies or a session",
  async (version) => {
    const response = await call(init(version));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 0,
      result: {
        protocolVersion: version.startsWith("2025-") ? version : "2025-11-25",
        capabilities: { tools: { listChanged: false } },
      },
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["mcp-session-id"]).toBeUndefined();
  },
);
it("advertises exactly two read-only tools and never exposes the internal write adapter", async () => {
  const response = await rpc("tools/list");
  const tools = response.json().result.tools;
  expect(tools.map((t: { name: string }) => t.name)).toEqual([
    "list_example_patterns",
    "get_example_pattern",
  ]);
  for (const tool of tools)
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  for (const name of [
    "create_pattern",
    "commit_pattern_edit",
    "delete_pattern",
  ])
    expect(
      (await rpc("tools/call", { name, arguments: {} })).json().error.code,
    ).toBe(-32602);
});
it("lists all stored patterns, paginates, and limits output to metadata without archives or secrets", async () => {
  const response = await rpc(
    "tools/call",
    { name: "list_example_patterns", arguments: { limit: 1 } },
    "list-id",
  );
  expect(response.json().id).toBe("list-id");
  const data = response.json().result.structuredContent;
  expect(data).toMatchObject({ total: 3, offset: 0, limit: 1, hasMore: true });
  expect(data.examples).toHaveLength(1);
  const found = await rpc("tools/call", {
    name: "get_example_pattern",
    arguments: { id: data.examples[0].id },
  });
  expect(found.json().result.structuredContent.example).toEqual(
    data.examples[0],
  );
  for (const value of [
    "PRIVATE_SOURCE_SENTINEL",
    "PRIVATE_TOKEN_SENTINEL",
    "cells",
    "archives",
    "Cookie",
    "DATABASE_PATH",
  ])
    expect(response.body + found.body).not.toContain(value);
  expect(data.examples[0].url).toMatch(
    /^https:\/\/perler.cloud\/api\/v1\/examples\//,
  );
  expect(
    (
      await rpc("tools/call", {
        name: "list_example_patterns",
        arguments: { offset: 3 },
      })
    ).json().result.structuredContent.examples,
  ).toEqual([]);
  const all = (await rpc("tools/call", { name: "list_example_patterns", arguments: {} })).json().result.structuredContent;
  expect(all.examples.map((p: { id: string }) => p.id).sort()).toEqual(store.list().map(p => p.id).sort());
  expect(all.examples.find((p: { id: string }) => p.id === "private-import").title).toBe("已上传图纸");
  const secondPage = (await rpc("tools/call", { name: "list_example_patterns", arguments: { offset: 1, limit: 2 } })).json().result.structuredContent;
  expect(secondPage).toMatchObject({ total: 3, hasMore: false });
  expect([data.examples[0], ...secondPage.examples]).toEqual(all.examples);
  expect(store.list()).toHaveLength(3);
  expect(store.get("private-import").revision).toBe(1);
});
it.each([
  { limit: 0 },
  { limit: "1" },
  { offset: -1 },
  { offset: Number.MAX_SAFE_INTEGER + 1 },
  { privatePath: ".env" },
])("returns a tool execution error for bad input %j", async (arguments_) => {
  const response = await rpc("tools/call", {
    name: "list_example_patterns",
    arguments: arguments_,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().result.isError).toBe(true);
});
it.each(["not-found", "../../.env"])(
  "rejects unknown patterns or server file paths %s",
  async (id) => {
    const response = await rpc("tools/call", {
      name: "get_example_pattern",
      arguments: { id },
    });
    expect(response.json().result.isError).toBe(true);
  },
);
it("accepts notifications and client responses with empty 202 bodies, and handles ping", async () => {
  for (const message of [
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    },
    { jsonrpc: "2.0", id: 2, result: {} },
  ]) {
    const response = await call(message);
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe("");
  }
  expect((await rpc("ping")).json()).toEqual({
    jsonrpc: "2.0",
    id: 0,
    result: {},
  });
});
it("distinguishes malformed JSON, invalid JSON-RPC, missing method params and unknown methods", async () => {
  const malformed = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: "{",
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json().error.code).toBe(-32700);
  for (const body of [
    null,
    {},
    { jsonrpc: "1.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: false, method: "ping" },
  ])
    expect((await call(body)).json().error.code).toBe(-32600);
  expect((await rpc("initialize")).json().error.code).toBe(-32602);
  expect((await rpc("unrecognized-method")).json().error.code).toBe(-32601);
});
it("handles bounded legacy batches but rejects modern and empty batches", async () => {
  const batch = [
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 2, method: "ping" },
  ];
  const legacy = await call(batch, { "mcp-protocol-version": "2025-03-26" });
  expect(legacy.statusCode).toBe(200);
  expect(legacy.json()).toHaveLength(2);
  expect((await call(batch)).statusCode).toBe(400);
  expect((await call([])).statusCode).toBe(400);
});
it.each([
  "https://evil.example",
  "null",
  "https://perler.cloud.evil.example",
  "https://chatgpt.com/",
])("rejects untrusted Origin %s on POST, GET and OPTIONS", async (origin) => {
  for (const method of ["POST", "GET", "OPTIONS"] as const) {
    const response = await app.inject({
      method,
      url: "/mcp",
      headers: { ...headers, origin },
      ...(method === "POST" ? { payload: JSON.stringify(init()) } : {}),
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  }
});
it("allows trusted CORS and server clients with no Origin while rejecting spoofed Host", async () => {
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/mcp",
    headers: { origin: "https://chatgpt.com", host: "perler.cloud" },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(
    "https://chatgpt.com",
  );
  expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
  expect(preflight.headers["access-control-allow-headers"]).toContain("Authorization");
  expect(
    (await call(init(), { origin: "https://chatgpt.com" })).statusCode,
  ).toBe(200);
  expect((await call(init(), { host: "evil.example" })).statusCode).toBe(403);
});
it("validates Accept, content type, version, size and rejects GET/DELETE with 405", async () => {
  for (const accept of [
    "application/json",
    "*/*",
    "application/json;q=0, text/event-stream",
  ])
    expect((await call(init(), { accept })).statusCode).toBe(406);
  expect(
    (await call(init(), { "content-type": "text/plain" })).statusCode,
  ).toBe(415);
  expect(
    (await call(init(), { "mcp-protocol-version": "2099-01-01" })).statusCode,
  ).toBe(400);
  expect(
    (await call({ ...init(), padding: "x".repeat(17000) })).statusCode,
  ).toBe(413);
  for (const method of ["GET", "DELETE"] as const)
    expect(
      (await app.inject({ method, url: "/mcp", headers })).statusCode,
    ).toBe(405);
});
it("keeps authenticated editing APIs intact while publishing all current pattern metadata and vector previews", async () => {
  expect((await app.inject("/api/v1/patterns")).statusCode).toBe(401);
  const examples = await app.inject("/api/v1/examples");
  expect(examples.statusCode).toBe(200);
  expect(examples.headers["cache-control"]).toBe("no-store");
  expect(examples.json().examples).toHaveLength(3);
  expect((await app.inject("/api/v1/examples/private-import")).statusCode).toBe(
    200,
  );
  const preview = await app.inject(
    "/api/v1/examples/mard-demo-3x2/preview.svg",
  );
  expect(preview.statusCode).toBe(200);
  expect(preview.headers["cache-control"]).toBe("no-store");
  expect(preview.body).toContain("<svg");
  expect(preview.body.match(/id="bead-/g)).toHaveLength(5);
});
it("reflects later imports, edits and deletions without restarting, and never returns archives or changes data", async () => {
  const uploaded = createSmallDemo();
  uploaded.patternId = "later-upload";
  uploaded.title = "后来上传的图纸";
  store.create(uploaded);
  const snapshot = () => JSON.stringify(["patterns", "revisions", "archives", "idempotency", "exports"].map(table => store.db.prepare("SELECT * FROM " + table).all()));
  const beforeRead = snapshot();
  const listed = (await rpc("tools/call", { name: "list_example_patterns", arguments: {} })).json().result.structuredContent;
  expect(listed.total).toBe(4);
  const read = () => rpc("tools/call", { name: "get_example_pattern", arguments: { id: uploaded.patternId } });
  const found = (await read()).json().result.structuredContent.example;
  const metadata = await app.inject(`/api/v1/examples/${uploaded.patternId}`);
  expect(metadata.headers["cache-control"]).toBe("no-store");
  expect(found.title).toBe(uploaded.title);
  expect(Object.keys(found).sort()).toEqual(["id", "title", "revision", "width", "height", "beadCount", "colorCount", "paletteId", "paletteVersion", "url", "previewUrl"].sort());
  const svg = await app.inject(`/api/v1/examples/${uploaded.patternId}/preview.svg`);
  expect(svg.statusCode).toBe(200);
  expect(svg.body.match(/id="bead-/g)).toHaveLength(found.beadCount);
  expect(snapshot()).toBe(beforeRead);
  store.commit(uploaded.patternId, { baseRevision: 1, operations: [{ type: "set_cell", x: 1, y: 1, newColor: null }] });
  const changed = (await read()).json().result.structuredContent.example;
  expect(changed.revision).toBe(2);
  expect(changed.beadCount).toBe(found.beadCount - 1);
  const updatedSvg = await app.inject(`/api/v1/examples/${uploaded.patternId}/preview.svg`);
  expect(updatedSvg.body.match(/id="bead-/g)).toHaveLength(changed.beadCount);
  store.delete(uploaded.patternId);
  expect((await read()).json().result.isError).toBe(true);
  expect((await app.inject(`/api/v1/examples/${uploaded.patternId}/preview.svg`)).statusCode).toBe(404);
  const remaining = (await rpc("tools/call", { name: "list_example_patterns", arguments: {} })).json().result.structuredContent;
  expect(remaining.total).toBe(3);
  expect(remaining.examples.some((p: { id: string }) => p.id === uploaded.patternId)).toBe(false);
});
it("uses the stored revision of built-in patterns and returns an empty catalog when all patterns are deleted", async () => {
  store.commit("mard-demo-3x2", { baseRevision: 1, operations: [{ type: "set_cell", x: 1, y: 1, newColor: null }] });
  const current = (await rpc("tools/call", { name: "get_example_pattern", arguments: { id: "mard-demo-3x2" } })).json().result.structuredContent.example;
  expect(current).toMatchObject({ revision: 2, beadCount: 4 });
  for (const p of store.list()) store.delete(p.id);
  expect((await app.inject("/api/v1/examples")).json().examples).toEqual([]);
  expect((await rpc("tools/call", { name: "list_example_patterns", arguments: {} })).json().result.structuredContent).toMatchObject({ total: 0, examples: [], hasMore: false });
  expect((await app.inject("/api/v1/examples/mard-demo-3x2")).statusCode).toBe(404);
});
it("connects with the official Streamable HTTP client over a real socket", async () => {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new Client({ name: "integration-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(address + "/mcp"),
  );
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(2);
    const listed = await client.callTool({
      name: "list_example_patterns",
      arguments: {},
    });
    expect(listed.isError).not.toBe(true);
    const found = await client.callTool({
      name: "get_example_pattern",
      arguments: { id: "mard-demo-3x2" },
    });
    expect(found.isError).not.toBe(true);
  } finally {
    await client.close();
  }
});
it("sanitizes backend failures without returning server paths or secret values", async () => {
  const isolated = Fastify();
  await registerPublicMcp(
    isolated,
    {
      list: () => {
        throw new Error("PRIVATE_FAILURE_SENTINEL C:/private/secret.env");
      },
      get: () => null,
      preview: () => null,
    },
    "https://perler.cloud",
  );
  try {
    const response = await isolated.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_example_patterns", arguments: {} },
      }),
    });
    expect(response.json().result.isError).toBe(true);
    expect(response.body).not.toContain("PRIVATE_FAILURE_SENTINEL");
    expect(response.body).not.toContain("secret.env");
  } finally {
    await isolated.close();
  }
});
it("bounds the request rate without changing workspace data", async () => {
  let last;
  for (let i = 0; i < 361; i++) last = await rpc("ping");
  expect(last!.statusCode).toBe(429);
  expect(last!.headers["retry-after"]).toBeTruthy();
  expect(store.get("private-import").revision).toBe(1);
});
it("starts in local mode when PUBLIC_ORIGIN is an empty string", async () => {
  const local = await buildApp({ store, seed: false, publicOrigin: "" });
  try {
    const response = await local.inject({ method: "POST", url: "/mcp", headers: { ...headers, host: "127.0.0.1:3001" }, payload: JSON.stringify(init()) });
    expect(response.statusCode).toBe(200); expect(response.json().result.protocolVersion).toBe("2025-11-25");
  } finally { await local.close(); }
});
