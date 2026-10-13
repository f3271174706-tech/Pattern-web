import { it, expect } from "vitest";
import { PatternStore } from "../apps/api/src/store";
import { createLocalMcpBoundary } from "../apps/api/src/mcp-boundary";
import { createSmallDemo } from "../packages/core/src/demo";
it("MCP boundary reuses services and enforces read/write and project authorization", async () => {
  const store = new PatternStore(":memory:");
  store.create(createSmallDemo());
  const adapter = createLocalMcpBoundary(
    store,
    (principal, id) =>
      principal === "owner" && (id === undefined || id === "demo-001"),
  );
  try {
    const read = { principal: "owner", scopes: ["patterns:read" as const] };
    const stats = (await adapter.call(
      "get_pattern_stats",
      { patternId: "demo-001" },
      read,
    )) as { beadCount: number };
    expect(stats.beadCount).toBe(5);
    await expect(
      adapter.call(
        "commit_pattern_edit",
        {
          patternId: "demo-001",
          request: {
            baseRevision: 1,
            operations: [{ type: "set_cell", x: 1, y: 1, newColor: null }],
          },
        },
        read,
      ),
    ).rejects.toThrow(/权限/);
    await expect(
      adapter.call(
        "get_pattern",
        { patternId: "demo-001" },
        { principal: "stranger", scopes: ["patterns:read"] },
      ),
    ).rejects.toThrow(/权限/);
    const result = (await adapter.call(
      "commit_pattern_edit",
      {
        patternId: "demo-001",
        request: {
          baseRevision: 1,
          operations: [{ type: "set_cell", x: 1, y: 1, newColor: null }],
          idempotencyKey: "mcp-test",
        },
      },
      { principal: "owner", scopes: ["patterns:write"] },
    )) as { pattern: { revision: number } };
    expect(result.pattern.revision).toBe(2);
  } finally {
    store.close();
  }
});
