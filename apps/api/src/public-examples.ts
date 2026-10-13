import {
  createMardDemo,
  createMardSmallDemo,
} from "../../../packages/core/src/mard-demo";
import { calculateStats } from "../../../packages/core/src/index";
import { renderSvg } from "../../../packages/core/src/scene";
import type { BeadPattern } from "../../../packages/core/src/types";
// Explicit public catalog, independent of SQLite, imports and original archives.
export function createPublicExampleCatalog(origin: string) {
  const patterns = new Map(
    [createMardSmallDemo(), createMardDemo()].map((p) => [p.patternId, p]),
  );
  const metadata = (p: BeadPattern) => {
    const stats = calculateStats(p);
    return {
      id: p.patternId,
      title: p.title,
      revision: p.revision,
      width: p.grid.width,
      height: p.grid.height,
      beadCount: stats.beadCount,
      colorCount: stats.colorCount,
      paletteId: p.palette.id,
      paletteVersion: p.palette.version,
      url: new URL(
        `/api/v1/examples/${encodeURIComponent(p.patternId)}`,
        origin,
      ).href,
      previewUrl: new URL(
        `/api/v1/examples/${encodeURIComponent(p.patternId)}/preview.svg`,
        origin,
      ).href,
    };
  };
  return {
    list: () => Array.from(patterns.values(), metadata),
    get: (id: string) => {
      const p = patterns.get(id);
      return p ? metadata(p) : null;
    },
    preview: (id: string) => {
      const p = patterns.get(id);
      return p ? renderSvg(p, "", undefined, "plain") : null;
    },
  };
}
export type PublicExampleCatalog = ReturnType<
  typeof createPublicExampleCatalog
>;
