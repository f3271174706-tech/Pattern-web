import assert from "node:assert/strict";
const origin = process.argv[2] ?? "https://perler.cloud";
const endpoint = new URL("/mcp", origin);
async function call(method, params, id = 1) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("set-cookie"), null);
  const message = await response.json();
  assert.equal(message.id, id);
  assert(!message.error, `${method}: JSON-RPC error`);
  return message.result;
}
const initialized = await call("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "readonly-production-check", version: "1.0.0" },
});
assert.equal(initialized.protocolVersion, "2025-11-25");
const notification = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": initialized.protocolVersion,
  },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  signal: AbortSignal.timeout(20000),
});
assert.equal(notification.status, 202);
assert.equal(await notification.text(), "");
const { tools } = await call("tools/list");
assert.deepEqual(
  tools.map((t) => t.name),
  ["list_example_patterns", "get_example_pattern"],
);
assert(
  tools.every(
    (t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint,
  ),
);
const listed = await call("tools/call", {
  name: "list_example_patterns",
  arguments: {},
});
assert(!listed.isError);
assert.equal(listed.structuredContent.total, 2);
const example = listed.structuredContent.examples[0];
const found = await call("tools/call", {
  name: "get_example_pattern",
  arguments: { id: example.id },
});
assert(!found.isError);
assert.deepEqual(found.structuredContent.example, example);
const publicPreview = new URL(example.previewUrl);
assert.equal(publicPreview.origin, "https://perler.cloud");
const preview = await fetch(new URL(publicPreview.pathname, origin), {
  signal: AbortSignal.timeout(20000),
});
assert.equal(preview.status, 200);
assert.match(preview.headers.get("content-type"), /image\/svg\+xml/);
assert.match(await preview.text(), /<svg\b/);
const rejected = await fetch(endpoint, {
  method: "POST",
  headers: {
    Origin: "https://evil.example",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
  signal: AbortSignal.timeout(20000),
});
assert.equal(rejected.status, 403);
console.log(
  JSON.stringify({
    endpoint: endpoint.href,
    verifiedAt: new Date().toISOString(),
    protocolVersion: initialized.protocolVersion,
    tools: tools.map((t) => t.name),
    publicExamples: listed.structuredContent.total,
    checks: [
      "initialize",
      "empty initialized notification ACK",
      "tools/list",
      "both readonly tools/call",
      "public SVG preview",
      "Origin rejection",
      "no session or cookie required",
    ],
  }),
);
