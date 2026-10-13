import type {
  BeadPattern,
  EditRequest,
  Palette,
  PatternStats,
  RevisionSummary,
} from "../../core/src/types";
import { DomainError } from "../../core/src/index";
export interface PatternService {
  create(input: BeadPattern): unknown;
  get(id: string, revision?: number): BeadPattern;
  stats(id: string, revision?: number): PatternStats;
  preview(id: string, request: EditRequest): unknown;
  commit(id: string, request: EditRequest): unknown;
  revisions(id: string): RevisionSummary[];
  export(
    id: string,
    format: "svg" | "pdf",
    revision?: number,
  ): Promise<{
    revision: number;
    digest: string;
    content: string | Uint8Array;
  }>;
}
export type Scope = "patterns:read" | "patterns:write";
export interface ToolContext {
  principal: string;
  scopes: Scope[];
}
export const toolDefinitions = [
  {
    name: "create_pattern",
    scope: "patterns:write",
    description:
      "Import a strictly validated BeadPattern v1; retain original JSON",
  },
  {
    name: "get_pattern",
    scope: "patterns:read",
    description: "Read current or immutable revision",
  },
  {
    name: "get_pattern_stats",
    scope: "patterns:read",
    description: "Compute exact statistics from JSON",
  },
  {
    name: "preview_pattern_edit",
    scope: "patterns:read",
    description: "Preview edits without persisting",
  },
  {
    name: "commit_pattern_edit",
    scope: "patterns:write",
    description: "Atomic optimistic commit with expectedColor and idempotency",
  },
  {
    name: "export_pattern_svg",
    scope: "patterns:read",
    description: "Export immutable revision as vector SVG",
  },
  {
    name: "export_pattern_pdf",
    scope: "patterns:read",
    description: "Export immutable revision as vector PDF",
  },
  {
    name: "get_pattern_revisions",
    scope: "patterns:read",
    description: "List immutable revision history",
  },
] as const;
export function createMcpAdapter(
  service: PatternService,
  canAccess: (principal: string, id?: string) => boolean,
) {
  return {
    definitions: toolDefinitions,
    async call(
      name: string,
      args: {
        patternId?: string;
        revision?: number;
        pattern?: BeadPattern;
        request?: EditRequest;
      },
      context: ToolContext,
    ) {
      const definition = toolDefinitions.find((t) => t.name === name);
      if (!definition)
        throw new DomainError("UNKNOWN_TOOL", "未知 MCP 工具", 404);
      if (
        !context.principal ||
        !context.scopes.includes(definition.scope) ||
        !canAccess(context.principal, args.patternId)
      )
        throw new DomainError("FORBIDDEN", "MCP 权限不足", 403);
      if (name === "create_pattern") {
        if (!args.pattern)
          throw new DomainError("INVALID_ARGUMENT", "缺少 pattern", 422);
        return service.create(args.pattern);
      }
      if (!args.patternId)
        throw new DomainError("INVALID_ARGUMENT", "缺少 patternId", 422);
      switch (name) {
        case "get_pattern":
          return service.get(args.patternId, args.revision);
        case "get_pattern_stats":
          return service.stats(args.patternId, args.revision);
        case "preview_pattern_edit":
          if (!args.request)
            throw new DomainError("INVALID_ARGUMENT", "缺少 request", 422);
          return service.preview(args.patternId, args.request);
        case "commit_pattern_edit":
          if (!args.request)
            throw new DomainError("INVALID_ARGUMENT", "缺少 request", 422);
          return service.commit(args.patternId, args.request);
        case "get_pattern_revisions":
          return service.revisions(args.patternId);
        case "export_pattern_svg":
          return service.export(args.patternId, "svg", args.revision);
        case "export_pattern_pdf":
          return service.export(args.patternId, "pdf", args.revision);
      }
    },
  };
}
