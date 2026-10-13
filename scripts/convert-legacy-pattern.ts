import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { previewPatternImport } from "../packages/core/src/import-pattern";
import { calculateStats } from "../packages/core/src/index";
const [input, output, mode = "source"] = process.argv.slice(2);
if (!input || !output || !["source", "mard221"].includes(mode)) throw new Error("Usage: npx tsx scripts/convert-legacy-pattern.ts input.json output.json [source|mard221]");
const result = previewPatternImport(await readFile(input, "utf8"), { patternId: randomUUID(), paletteMode: mode as "source" | "mard221" });
await writeFile(output, JSON.stringify(result.pattern, null, 2), { flag: "wx" });
console.log(JSON.stringify({ output, title: result.pattern.title, beads: calculateStats(result.pattern).beadCount, colors: calculateStats(result.pattern).colorCount, paletteMode: mode, paletteConflicts: result.paletteConflicts.length, warnings: result.warnings }));
