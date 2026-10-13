import { calculateStats, DomainError } from "../../../packages/core/src/index";
import { renderSvg } from "../../../packages/core/src/scene";
import type { BeadPattern } from "../../../packages/core/src/types";
import type { PatternStore } from "./store";
// Public by the owner's instruction: current workspace patterns, read-only.
// Read pattern snapshots only; never expose store.state() or original archives.
export function createPublicExampleCatalog(
  origin: string,
  store: Pick<PatternStore, "currentPatterns" | "get">,
) {
  const read = (id: string) => {
    try {
      return store.get(id);
    } catch (error) {
      if (error instanceof DomainError && error.code === "PATTERN_NOT_FOUND")
        return null;
      throw error;
    }
  };
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
    list: () => store.currentPatterns().map(metadata),
    get: (id: string) => {
      const p = read(id);
      return p ? metadata(p) : null;
    },
    preview: (id: string) => {
      const p = read(id);
      return p ? renderSvg(p, "", undefined, "plain") : null;
    },
  };
}
export type PublicExampleCatalog = ReturnType<
  typeof createPublicExampleCatalog
>;
