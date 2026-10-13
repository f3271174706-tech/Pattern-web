import { createMcpAdapter } from "../../../packages/mcp-adapter/src/index";
import { calculateStats } from "../../../packages/core/src/index";
import { PatternStore } from "./store";
import { exportInWorker } from "./export-worker";
// Transport-independent boundary, deliberately not a public MCP server.
export function createLocalMcpBoundary(
  store: PatternStore,
  canAccess: (principal: string, id?: string) => boolean,
) {
  return createMcpAdapter(
    {
      create: (p) => store.create(p),
      get: (id, r) => store.get(id, r),
      stats: (id, r) => calculateStats(store.get(id, r)),
      preview: (id, request) => store.preview(id, request),
      commit: (id, request) => store.commit(id, request),
      revisions: (id) => store.history(id),
      export: async (id, format, revision) => {
        const p = store.get(id, revision),
          digest = store.revisionRow(id, p.revision).digest;
        const content = await exportInWorker(p, format, digest);
        store.recordExport(id, p.revision, format, content);
        return { revision: p.revision, digest, content };
      },
    },
    canAccess,
  );
}
