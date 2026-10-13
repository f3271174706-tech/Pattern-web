import { mkdir, writeFile } from "node:fs/promises";
import { openapi } from "../apps/api/src/openapi";
import { createDemo, createSmallDemo } from "../packages/core/src/demo";
import { createMardDemo, createMardSmallDemo } from "../packages/core/src/mard-demo";
await mkdir("docs/api", { recursive: true });
await writeFile("docs/api/openapi.json", JSON.stringify(openapi, null, 2));
await writeFile(
  "examples/demo-3x2.json",
  JSON.stringify(createSmallDemo(), null, 2),
);
await writeFile(
  "examples/garden-58x58.json",
  JSON.stringify(createDemo(), null, 2),
);
await writeFile(
  "examples/mard-garden-58x58.json",
  JSON.stringify(createMardDemo(), null, 2),
);
console.log("OpenAPI and example patterns generated.");
await writeFile("examples/mard-demo-3x2.json", JSON.stringify(createMardSmallDemo(), null, 2));
