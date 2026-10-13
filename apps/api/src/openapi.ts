import pattern from "../../../docs/json-schema/bead-pattern-v1.schema.json";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });
const integer = { type: "integer", minimum: 1 };
const cell = { anyOf: [{ type: "string" }, { type: "null" }] };
const rect = {
  type: "object",
  additionalProperties: false,
  required: ["x1", "y1", "x2", "y2"],
  properties: Object.fromEntries(
    ["x1", "y1", "x2", "y2"].map((k) => [k, integer]),
  ),
};
const operation = (
  type: string,
  properties: Record<string, unknown>,
  required: string[],
) => ({
  type: "object",
  additionalProperties: false,
  required: ["type", ...required],
  properties: { type: { const: type }, ...properties },
});
export const editSchema = {
  type: "object",
  additionalProperties: false,
  required: ["baseRevision", "operations"],
  properties: {
    baseRevision: integer,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 100 },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 1000,
      items: {
        oneOf: [
          operation(
            "set_cell",
            { x: integer, y: integer, newColor: cell, expectedColor: cell },
            ["x", "y", "newColor"],
          ),
          operation("replace_color", { oldColor: cell, newColor: cell }, [
            "oldColor",
            "newColor",
          ]),
          operation(
            "replace_color_in_rect",
            { rect, oldColor: cell, newColor: cell },
            ["rect", "oldColor", "newColor"],
          ),
          operation(
            "fill_rect",
            {
              rect,
              newColor: cell,
              expectedColor: cell,
              nonEmptyOnly: { type: "boolean" },
            },
            ["rect", "newColor"],
          ),
        ],
      },
    },
  },
};
const baseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["baseRevision"],
  properties: { baseRevision: integer },
};
const success = (schema: unknown = { type: "object" }) => ({
  description: "Success",
  content: json(schema),
});
const errors = {
  "401": {
    description: "Authentication required",
    content: json(ref("Error")),
  },
  "404": {
    description: "Pattern or revision not found",
    content: json(ref("Error")),
  },
  "409": {
    description:
      "Revision, expectedColor, duplicate ID or idempotency conflict",
    content: json(ref("Error")),
  },
  "422": { description: "Input validation error", content: json(ref("Error")) },
};
function endpoint(
  summary: string,
  body?: unknown,
  extra: Record<string, unknown> = {},
) {
  return {
    summary,
    security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
    responses: { "200": success(), ...errors },
    ...extra,
  };
}
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
};
const revisionQuery = { name: "revision", in: "query", schema: integer };
const revisionPath = { ...revisionQuery, in: "path", required: true };
const archive = {
  type: "object",
  additionalProperties: false,
  required: ["name", "format", "base64"],
  properties: {
    name: { type: "string", maxLength: 255 },
    format: { enum: ["svg", "pdf"] },
    base64: { type: "string" },
  },
};
const importWrapper = {
  type: "object",
  additionalProperties: false,
  required: ["pattern"],
  properties: {
    pattern: ref("BeadPattern"),
    rawJson: { type: "string" },
    importOptions: {
      type: "object",
      additionalProperties: false,
      required: ["format", "paletteMode"],
      properties: {
        format: { const: "legacy-grid-v1" },
        paletteMode: { enum: ["source", "mard221"] },
      },
      description:
        "Explicit legacy conversion. rawJson is required, archived verbatim, and converted again on the server to verify pattern equality.",
    },
    originals: { type: "array", maxItems: 2, items: archive },
  },
};
const paths: Record<string, unknown> = {};
paths["/examples"] = {
  get: endpoint(
    "List explicit public MARD examples (excludes workspace projects)",
    undefined,
    { security: [] },
  ),
};
paths["/examples/{id}"] = {
  parameters: [id],
  get: endpoint("Read public example metadata", undefined, { security: [] }),
};
paths["/examples/{id}/preview.svg"] = {
  parameters: [id],
  get: endpoint("Read public example vector preview", undefined, {
    security: [],
    responses: {
      "200": {
        description: "Vector SVG",
        content: { "image/svg+xml": { schema: { type: "string" } } },
      },
      ...errors,
    },
  }),
};
paths["/patterns"] = {
  get: endpoint("List projects"),
  post: endpoint(
    "Import JSON and optional original archives",
    { oneOf: [ref("BeadPattern"), importWrapper] },
    { responses: { "201": success(ref("PatternState")), ...errors } },
  ),
};
paths["/patterns/{id}"] = {
  parameters: [id],
  get: endpoint("Get current state or a specified revision", undefined, {
    parameters: [revisionQuery],
    responses: { "200": success(ref("PatternState")), ...errors },
  }),
  delete: endpoint("Explicitly delete project, revisions and archives"),
};
paths["/patterns/{id}/stats"] = {
  parameters: [id],
  get: endpoint("Compute bead and board statistics from JSON", undefined, {
    parameters: [
      revisionQuery,
      { name: "format", in: "query", schema: { enum: ["json", "csv"] } },
    ],
    responses: { "200": success(ref("Stats")), ...errors },
  }),
};
for (const action of ["preview", "commit"])
  paths[`/patterns/{id}/edits/${action}`] = {
    parameters: [id],
    post: endpoint(
      action === "preview"
        ? "Preview without changing stored data"
        : "Commit atomic operations as a new revision",
      ref("EditRequest"),
    ),
  };
paths["/patterns/{id}/revisions"] = {
  parameters: [id],
  get: endpoint("List immutable revisions"),
};
paths["/patterns/{id}/revisions/{revision}"] = {
  parameters: [id, revisionPath],
  get: endpoint("Get an immutable BeadPattern snapshot"),
};
paths["/patterns/{id}/revisions/{revision}/restore"] = {
  parameters: [id, revisionPath],
  post: endpoint("Restore into a new revision, retain history", baseSchema),
};
for (const action of ["undo", "redo"])
  paths[`/patterns/{id}/${action}`] = {
    parameters: [id],
    post: endpoint(
      `Persist ${action} as a new revision; stacks survive restart`,
      baseSchema,
    ),
  };
paths["/patterns/{id}/layout"] = {
  parameters: [id],
  put: endpoint("Update layout without changing bead cells", {
    ...baseSchema,
    required: ["baseRevision", "layout"],
    properties: { ...baseSchema.properties, layout: pattern.properties.layout },
  }),
};
paths["/patterns/{id}/palette"] = {
  parameters: [id],
  put: endpoint("Explicit palette binding; reject absent used codes", {
    ...baseSchema,
    required: ["baseRevision", "palette"],
    properties: {
      ...baseSchema.properties,
      palette: pattern.properties.palette,
    },
  }),
};
paths["/patterns/{id}/diff"] = {
  parameters: [id],
  get: endpoint("Compare cells in two revisions", undefined, {
    parameters: ["from", "to"].map((name) => ({
      name,
      in: "query",
      required: true,
      schema: integer,
    })),
  }),
};
paths["/patterns/{id}/archives"] = {
  parameters: [id],
  get: endpoint("List preserved original files"),
};
paths["/patterns/{id}/archives/{archiveId}"] = {
  parameters: [
    id,
    { name: "archiveId", in: "path", required: true, schema: integer },
  ],
  get: endpoint("Download an original file as attachment"),
};
paths["/patterns/{id}/export-records"] = {
  parameters: [id],
  get: endpoint("List export revisions and SHA-256 digests"),
};
paths["/palettes"] = { get: endpoint("Get palette presets and provenance") };
for (const format of ["svg", "pdf", "json"]) {
  const media =
    format === "pdf"
      ? "application/pdf"
      : format === "svg"
        ? "image/svg+xml"
        : "application/json";
  const parameters: unknown[] = [
    revisionQuery,
    ...["x1", "y1", "x2", "y2"].map((name) => ({
      name,
      in: "query",
      schema: integer,
    })),
  ];
  if (format === "svg")
    parameters.push({
      name: "mode",
      in: "query",
      schema: { enum: ["layout", "plain", "grid", "coordinates", "boards"] },
    });
  const response = {
    description: "Revision-bound export",
    headers: {
      "X-Pattern-Revision": { schema: integer },
      "X-Pattern-Digest": { schema: { type: "string" } },
    },
    content: {
      [media]: {
        schema: {
          type: "string",
          ...(format === "pdf" ? { format: "binary" } : {}),
        },
      },
    },
  };
  paths[`/patterns/{id}/exports/${format}`] = {
    parameters: [id],
    get: endpoint(
      `Export ${format.toUpperCase()} from an immutable snapshot`,
      undefined,
      {
        parameters,
        responses: {
          "200": response,
          "429": { description: "Export worker capacity reached" },
          "503": { description: "Export timeout" },
          ...errors,
        },
      },
    ),
  };
}
const cleanPattern = { ...pattern } as Record<string, unknown>;
delete cleanPattern.$schema;
delete cleanPattern.$id;
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Bead Pattern Workbench REST API",
    version: "1.0.0",
    description:
      "JSON is authoritative. Coordinates are 1-based from top-left. Remote mode requires authentication; local loopback checks Host and Origin.",
  },
  servers: [{ url: "/api/v1" }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "bead_session" },
    },
    schemas: {
      BeadPattern: cleanPattern,
      Rect: rect,
      EditRequest: editSchema,
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "path"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              path: { type: "string" },
              details: {},
            },
          },
        },
      },
      PatternState: {
        type: "object",
        required: ["pattern", "digest"],
        properties: {
          pattern: ref("BeadPattern"),
          digest: { type: "string" },
          canUndo: { type: "boolean" },
          canRedo: { type: "boolean" },
          archives: { type: "array", items: { type: "object" } },
        },
      },
      Stats: {
        type: "object",
        required: [
          "revision",
          "totalCells",
          "beadCount",
          "emptyCount",
          "colorCount",
          "colors",
          "boards",
        ],
        properties: {
          revision: integer,
          totalCells: integer,
          beadCount: { type: "integer", minimum: 0 },
          emptyCount: { type: "integer", minimum: 0 },
          colorCount: { type: "integer", minimum: 0 },
          colors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                name: { type: "string" },
                hex: { type: "string" },
                count: integer,
                percentage: { type: "number" },
              },
            },
          },
          boards: { type: "array", items: { type: "object" } },
        },
      },
    },
  },
};
