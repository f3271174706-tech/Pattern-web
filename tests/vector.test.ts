import { describe, it, expect } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { createDemo, createSmallDemo } from "../packages/core/src/demo";
import { calculateStats, applyEdits } from "../packages/core/src/index";
import {
  createScene,
  renderSvg,
  paginatePattern,
} from "../packages/core/src/scene";
import { renderPdf } from "../packages/core/src/pdf";
import { buildApp } from "../apps/api/src/app";
import { digestOf } from "../apps/api/src/store";
const font = readFileSync(
  new URL("../assets/fonts/NotoSansSC-Regular.ttf", import.meta.url),
);
describe("shared geometry, vector SVG/PDF and export revision consistency", () => {
  it("selection exports count materials only inside the exported range", async () => {
    const p=createSmallDemo(), range={x1:1,y1:1,x2:2,y2:1};
    const svg=renderSvg(p,digestOf(p),range);
    expect([...svg.matchAll(/id="bead-/g)]).toHaveLength(2);
    expect(svg).toContain("2 beads");
    const pdf=await PDFDocument.load(await renderPdf(p,digestOf(p),font,range));
    const embedded=[...pdf.context.enumerateIndirectObjects()].map(([,o])=>o).filter((o):o is PDFRawStream=>o instanceof PDFRawStream&&o.dict.get(PDFName.of("Type"))===PDFName.of("EmbeddedFile")).map(o=>JSON.parse(Buffer.from(decodePDFRawStream(o).decode()).toString()));
    expect(embedded.find(o=>o.beads).beads).toHaveLength(2);
    const materialPage=pdf.getPages().at(-1)!;
    const contents=materialPage.node.Contents()!;
    const streams="asArray" in contents?contents.asArray():[contents];
    const operators=streams.map(s=>pdf.context.lookup(s)).filter((s):s is PDFRawStream=>s instanceof PDFRawStream).map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString()).join("\n");
    // Exactly one material swatch: C02 occurs only outside this range.
    expect(operators.match(/\nB\n/g)).toHaveLength(1);
  });
  it("creates exactly one independent SVG rectangle per nonempty bead with exact coordinates/colors", () => {
    const p = createSmallDemo(),
      svg = renderSvg(p);
    const beads = [
      ...svg.matchAll(
        /<rect id="bead-(\d+)-(\d+)" data-x="(\d+)" data-y="(\d+)" data-color="([^"]+)"[^>]+fill="([^"]+)"/g,
      ),
    ];
    expect(beads).toHaveLength(5);
    for (const m of beads) {
      const x = Number(m[1]),
        y = Number(m[2]);
      expect(p.grid.cells[y - 1][x - 1]).toBe(m[5]);
      expect(p.palette.colors[m[5]].hex).toBe(m[6]);
      expect(Number(m[3])).toBe(x);
      expect(Number(m[4])).toBe(y);
    }
    expect(svg).not.toContain("<image");
    expect(svg).toContain("viewBox=");
  });
  it("escapes untrusted titles and names and generates four SVG modes", () => {
    const p = createSmallDemo();
    p.title = "<script>alert(1)</script>";
    expect(renderSvg(p)).not.toContain("<script>");
    expect(renderSvg(p)).toContain("&lt;script&gt;");
    const plain = renderSvg(p, "", undefined, "plain");
    expect(plain).not.toContain("<line");
    expect(renderSvg(p, "", undefined, "grid")).toContain("<line");
    expect(renderSvg(p, "", undefined, "coordinates")).toContain(">1</text>");
  });
  it("pagination covers each coordinate once and preserves 5 mm physical geometry", () => {
    const p = createDemo(),
      pages = paginatePattern(p);
    expect(pages).toHaveLength(4);
    const positions = new Set();
    for (const r of pages) {
      for (let y = r.y1; y <= r.y2; y++)
        for (let x = r.x1; x <= r.x2; x++) {
          const key = `${x},${y}`;
          expect(positions.has(key)).toBe(false);
          positions.add(key);
        }
      for (const e of createScene(p, r, false).elements)
        if (e.kind === "rect" && e.bead) expect(e.width).toBe(5);
    }
    expect(positions.size).toBe(3364);
  });
  it("splits oversize boards and limits range without overlaps", () => {
    const p = createDemo();
    p.layout.board.width = p.layout.board.height = 50;
    const tiles = paginatePattern(p, { x1: 10, y1: 10, x2: 55, y2: 54 });
    const total = tiles.reduce(
      (a, r) => a + (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1),
      0,
    );
    expect(total).toBe(46 * 45);
    expect(tiles.length).toBeGreaterThan(1);
  });
  it("PDF contains rectangle and text operators, embedded Chinese font, and no bitmap XObjects", async () => {
    const p = createSmallDemo(),
      bytes = await renderPdf(p, digestOf(p), font),
      pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    let imageCount = 0;
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      )
        imageCount++;
    }
    expect(imageCount).toBe(0);
    const contents = pdf.getPage(0).node.Contents();
    const streams = contents
      ? "asArray" in contents
        ? contents.asArray()
        : [contents]
      : [];
    const operators = streams
      .map((s) => pdf.context.lookup(s))
      .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
      .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString())
      .join("\n");
    expect(operators.match(/\nf\n/g)).toHaveLength(5);
    expect(operators).toContain("BT");
    expect(operators).toContain("Tj");
    expect(pdf.getTitle()).toContain(p.title);
    mkdirSync("output/pdf", { recursive: true });
    writeFileSync("output/pdf/acceptance-3x2.pdf", bytes);
  });
  it("SVG/PDF API exports bind to the same snapshot even while latest revision changes", async () => {
    const app = await buildApp({ databasePath: ":memory:", seed: false });
    try {
      const p = createSmallDemo();
      await app.inject({ method: "POST", url: "/api/v1/patterns", payload: p });
      const commit = await app.inject({
        method: "POST",
        url: "/api/v1/patterns/demo-001/edits/commit",
        payload: {
          baseRevision: 1,
          operations: [{ type: "set_cell", x: 1, y: 1, newColor: "C02" }],
        },
      });
      expect(commit.json().pattern.revision).toBe(2);
      const [svg, pdf] = await Promise.all([
        app.inject("/api/v1/patterns/demo-001/exports/svg?revision=1"),
        app.inject("/api/v1/patterns/demo-001/exports/pdf?revision=1"),
      ]);
      expect(svg.statusCode).toBe(200);
      expect(pdf.statusCode).toBe(200);
      expect(svg.headers["x-pattern-revision"]).toBe("1");
      expect(pdf.headers["x-pattern-digest"]).toBe(
        svg.headers["x-pattern-digest"],
      );
      expect(svg.body).toContain('data-color="C01"');
      const loaded = await PDFDocument.load(pdf.rawPayload);
      const embedded = [...loaded.context.enumerateIndirectObjects()]
        .map(([, o]) => o)
        .filter(
          (o): o is PDFRawStream =>
            o instanceof PDFRawStream &&
            o.dict.get(PDFName.of("Type")) === PDFName.of("EmbeddedFile"),
        )
        .map((o) =>
          JSON.parse(Buffer.from(decodePDFRawStream(o).decode()).toString()),
        );
      const manifest = embedded.find((o) => o.beads);
      expect(manifest.revision).toBe(1);
      expect(manifest.beads).toHaveLength(calculateStats(p).beadCount);
      for (const b of manifest.beads) {
        expect(p.grid.cells[b.y - 1][b.x - 1]).toBe(b.code);
        expect(b.hex).toBe(p.palette.colors[b.code].hex);
        expect(svg.body).toContain(`id="bead-${b.x}-${b.y}"`);
      }
      const records = (
        await app.inject("/api/v1/patterns/demo-001/export-records")
      ).json();
      expect(records).toHaveLength(2);
      expect(records[0].revision).toBe(1);
    } finally {
      await app.close();
    }
  });
  it("exports a real 58脳58 multipage example with material table for visual review", async () => {
    const p = createDemo(),
      bytes = await renderPdf(p, digestOf(p), font);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(5);
    mkdirSync("output/pdf", { recursive: true });
    writeFileSync("output/pdf/garden-58x58-v1.pdf", bytes);
    writeFileSync("output/pdf/garden-58x58-v1.svg", renderSvg(p, digestOf(p)));
  });
});
