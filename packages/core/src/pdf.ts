import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFHexString,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { BeadPattern, Rect } from "./types";
import { calculateStats } from "./index";
import {
  createScene,
  fullRect,
  paginatePattern,
  paperDimensions,
} from "./scene";
const MM = 72 / 25.4;
const color = (hex: string) =>
  rgb(
    ...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ]),
  );
export async function renderPdf(
  p: BeadPattern,
  digest = "",
  fontBytes?: Uint8Array,
  range: Rect = fullRect(p),
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Embed the complete TrueType cmap: fontkit's CJK subset encoding drops glyphs
  // in several PDF readers. Full embedding preserves Chinese titles and labels.
  const unicode = fontBytes
    ? await doc.embedFont(fontBytes, { subset: false })
    : undefined;
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  if (!unicode && /[^\x20-\x7E]/.test(p.title))
    throw new Error(
      "缺少中文字体 assets/fonts/NotoSansSC-Regular.ttf，请恢复随源码分发的字体文件",
    );
  const fontFor = (text: string) =>
    /[^\x20-\x7E]/.test(text) ? unicode! : latin;
  const runs = (text: string) =>
    text.match(/[\x20-\x7E]+|[^\x20-\x7E]+/g) ?? [];
  const textWidth = (text: string, size: number) =>
    runs(text).reduce(
      (sum, run) => sum + fontFor(run).widthOfTextAtSize(run, size),
      0,
    );
  const drawText = (
    page: PDFPage,
    text: string,
    options: { x: number; y: number; size: number; color?: RGB },
  ) => {
    let x = options.x;
    for (const run of runs(text)) {
      const font = fontFor(run);
      page.drawText(run, { ...options, x, font });
      x += font.widthOfTextAtSize(run, options.size);
    }
  };
  doc.setTitle(`${p.title} v${p.revision}`);
  doc.setSubject(`BeadPattern v1 | ${digest}`);
  doc.setAuthor("Bead Pattern Workbench");
  doc.setProducer("Workbench shared vector scene / pdf-lib");
  const [pw, ph] = paperDimensions(p),
    margin = p.layout.paper.marginMm,
    tiles = paginatePattern(p, range);
  const manifest: {
    revision: number;
    digest: string;
    beads: { x: number; y: number; code: string; hex: string; page: number }[];
  } = { revision: p.revision, digest, beads: [] };
  for (const [pageIndex, rect] of tiles.entries()) {
    const page = doc.addPage([pw * MM, ph * MM]),
      scene = createScene(p, rect, false);
    for (const e of scene.elements) {
      if (e.kind === "rect") {
        page.drawRectangle({
          x: (margin + e.x) * MM,
          y: (ph - margin - e.y - e.height) * MM,
          width: e.width * MM,
          height: e.height * MM,
          color: color(e.fill),
        });
        if (e.bead)
          manifest.beads.push({
            x: e.bead.x,
            y: e.bead.y,
            code: e.bead.code,
            hex: e.fill,
            page: pageIndex + 1,
          });
      } else if (e.kind === "line")
        page.drawLine({
          start: { x: (margin + e.x1) * MM, y: (ph - margin - e.y1) * MM },
          end: { x: (margin + e.x2) * MM, y: (ph - margin - e.y2) * MM },
          thickness: e.width * MM,
          color: color(e.color),
        });
      else {
        const size = e.size * MM;
        const maxWidth = (pw - 2 * margin - e.x) * MM;
        let fitted = size;
        if (e.align !== "center" && textWidth(e.text, size) > maxWidth)
          fitted = (size * maxWidth) / textWidth(e.text, size);
        drawText(page, e.text, {
          size: fitted,
          x:
            (margin + e.x) * MM -
            (e.align === "center" ? textWidth(e.text, fitted) / 2 : 0),
          y: (ph - margin - e.y) * MM - fitted * 0.35,
          color: color(e.color),
        });
      }
    }
    page.drawText(
      `v${p.revision} | page ${pageIndex + 1}/${tiles.length} | SHA256 ${digest.slice(0, 16)}`,
      {
        font: latin,
        size: 7,
        x: margin * MM,
        y: Math.max(5, margin / 2) * MM,
        color: rgb(0.4, 0.45, 0.5),
      },
    );
    page.node.set(PDFName.of("BeadRevision"), doc.context.obj(p.revision));
    page.node.set(
      PDFName.of("BeadRange"),
      PDFHexString.fromText(JSON.stringify(rect)),
    );
  }
  const stats = calculateStats(p, range),
    rows = stats.colors;
  const rowHeight = 7;
  const perPage = Math.floor((ph - 2 * margin - 40) / rowHeight);
  for (let offset = 0; offset < Math.max(rows.length, 1); offset += perPage) {
    const page = doc.addPage([pw * MM, ph * MM]);
    const title = `材料用量 · ${p.title} · v${p.revision}`;
    const titleText = unicode
      ? title
      : `Materials | ${p.patternId} | v${p.revision}`;
    const titleSize = Math.min(
      13,
      ((pw - 2 * margin) * MM) / textWidth(titleText, 1),
    );
    drawText(page, titleText, {
      size: titleSize,
      x: margin * MM,
      y: (ph - margin - 6) * MM,
    });
    page.drawText(
      `${stats.beadCount} beads | ${stats.emptyCount} empty | ${stats.colorCount} colors | ${p.grid.width} x ${p.grid.height}`,
      { font: latin, size: 9, x: margin * MM, y: (ph - margin - 14) * MM },
    );
    const columns = [
      margin,
      margin + 10,
      margin + Math.min(100, pw * 0.45),
      pw - margin - 30,
    ];
    page.drawText("CODE / NAME", {
      font: latin,
      size: 8,
      x: columns[1] * MM,
      y: (ph - margin - 24) * MM,
    });
    page.drawText("COUNT", {
      font: latin,
      size: 8,
      x: columns[2] * MM,
      y: (ph - margin - 24) * MM,
    });
    page.drawText("SHARE", {
      font: latin,
      size: 8,
      x: columns[3] * MM,
      y: (ph - margin - 24) * MM,
    });
    rows.slice(offset, offset + perPage).forEach((c, i) => {
      const yy = ph - margin - 32 - i * rowHeight;
      page.drawRectangle({
        x: columns[0] * MM,
        y: (yy - 1) * MM,
        width: 4 * MM,
        height: 4 * MM,
        color: color(c.hex),
        borderColor: rgb(0.75, 0.78, 0.8),
        borderWidth: 0.25,
      });
      const label = `${c.code}  ${c.name}`,
        size = Math.min(
          9,
          ((columns[2] - columns[1] - 4) * MM) / textWidth(label, 1),
        );
      drawText(page, label, { size, x: columns[1] * MM, y: yy * MM });
      page.drawText(String(c.count), {
        font: latin,
        size: 9,
        x: columns[2] * MM,
        y: yy * MM,
      });
      page.drawText(`${c.percentage.toFixed(1)}%`, {
        font: latin,
        size: 9,
        x: columns[3] * MM,
        y: yy * MM,
      });
    });
  }
  await doc.attach(
    new TextEncoder().encode(JSON.stringify(p)),
    `pattern-v${p.revision}.json`,
    {
      mimeType: "application/json",
      description: "Authoritative BeadPattern snapshot",
    },
  );
  await doc.attach(
    new TextEncoder().encode(JSON.stringify(manifest)),
    `vector-manifest-v${p.revision}.json`,
    {
      mimeType: "application/json",
      description: "Each vector bead maps to JSON coordinates and its PDF page",
    },
  );
  return doc.save();
}
