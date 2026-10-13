import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const origin = "https://perler.cloud";
const example = JSON.parse(
  await readFile(
    new URL("../../examples/mard-garden-58x58.json", import.meta.url),
    "utf8",
  ),
);
example.patternId = "minimal-public-" + randomUUID();
example.title = "极简界面验收（临时）";
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
const context = await browser.newContext({
    viewport: { width: 1600, height: 1040 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let created = false;
try {
  assert.equal(
    (
      await page.goto(origin + "/?minimal-check=" + Date.now(), {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      })
    ).status(),
    200,
  );
  const before = await (
    await page.request.get(origin + "/api/v1/patterns")
  ).json();
  assert.equal(
    (
      await page.request.post(origin + "/api/v1/patterns", { data: example })
    ).status(),
    201,
  );
  created = true;
  await page.reload();
  await page.getByRole("button").filter({ hasText: example.title }).click();
  await page.getByRole("heading", { name: "图纸信息", exact: true }).waitFor();
  assert.equal(await page.getByText("精确定位", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("X 坐标", { exact: true }).count(), 0);
  assert.equal(
    await page.getByText("JSON 权威数据源", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("每颗珠子，精确可追溯", { exact: true }).count(),
    0,
  );
  const codes = page.getByRole("switch", { name: "显示色号", exact: true }),
    boards = page.getByRole("switch", { name: "拼板编号", exact: true });
  assert.equal(await boards.getAttribute("aria-checked"), "false");
  const usedCodes = new Set(
    example.grid.cells.flat().filter((c) => c !== null),
  );
  const used = page.getByLabel("图纸已用颜色", { exact: true }),
    remaining = page.getByLabel("剩余颜色", { exact: true });
  const fromButtons = (locator) =>
    locator.evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute("aria-label").replace("选择色号 ", "")),
    );
  assert.deepEqual(
    (await fromButtons(used.locator("button"))).sort(),
    [...usedCodes].sort(),
  );
  const remainingCodes = await fromButtons(remaining.locator("button"));
  assert.equal(remainingCodes.length, 221 - usedCodes.size);
  assert(remainingCodes.every((code) => !usedCodes.has(code)));
  for (const group of await remaining.locator(".palette-group").all()) {
    const letter = await group.locator("summary strong").textContent();
    assert(
      (await fromButtons(group.locator("button"))).every((code) =>
        code.startsWith(letter),
      ),
    );
  }
  const rendered = await page
    .locator(".color-grid button")
    .evaluateAll((buttons) =>
      buttons.map((b) => ({
        code: b.getAttribute("aria-label").replace("选择色号 ", ""),
        rgb: b.querySelector(".swatch").style.backgroundColor,
      })),
    );
  assert.equal(rendered.length, 221);
  for (const { code, rgb } of rendered)
    assert.equal(
      "#" +
        rgb
          .match(/\d+/g)
          .slice(0, 3)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase(),
      example.palette.colors[code].hex.toUpperCase(),
    );
  await mkdir("output/deploy", { recursive: true });
  await page.mouse.move(500, 80);
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.screenshot({ path: "output/deploy/minimal-workbench-live.png" });
  await codes.click();
  await page.locator(".revision-chip").filter({ hasText: "v2" }).waitFor();
  await boards.click();
  await page.locator(".revision-chip").filter({ hasText: "v3" }).waitFor();
  await page.reload();
  await page.locator(".revision-chip").filter({ hasText: "v3" }).waitFor();
  assert.equal(await codes.getAttribute("aria-checked"), "true");
  assert.equal(await boards.getAttribute("aria-checked"), "true");
  const state = await (
    await page.request.get(origin + "/api/v1/patterns/" + example.patternId)
  ).json();
  assert.deepEqual(state.pattern.grid.cells, example.grid.cells);
  assert.equal(state.pattern.layout.showColorCodes, true);
  assert.equal(state.pattern.layout.board.showLabels, true);
  const svg = await (
    await page.request.get(
      origin + `/api/v1/patterns/${example.patternId}/exports/svg?revision=3`,
    )
  ).text();
  assert(svg.includes(">B1-1</text>"));
  assert(svg.includes(">H7</text>"));
  await boards.click();
  await page.locator(".revision-chip").filter({ hasText: "v4" }).waitFor();
  const hidden = await (
    await page.request.get(
      origin + `/api/v1/patterns/${example.patternId}/exports/svg?revision=4`,
    )
  ).text();
  assert(!hidden.includes(">B1-1</text>"));
  assert.deepEqual(errors, []);
  assert.equal(
    (
      await page.request.delete(
        origin + "/api/v1/patterns/" + example.patternId,
      )
    ).status(),
    200,
  );
  created = false;
  const after = await (
    await page.request.get(origin + "/api/v1/patterns")
  ).json();
  assert.deepEqual(
    after.map((p) => p.id).sort(),
    before.map((p) => p.id).sort(),
  );
  const report = {
    origin,
    verifiedAt: new Date().toISOString(),
    usedColors: usedCodes.size,
    remainingColors: remainingCodes.length,
    checks: [
      "no login required",
      "precision panel removed",
      "pattern information retained",
      "used and remaining palettes are disjoint and complete",
      "remaining groups match letters",
      "all 221 displayed HEX values unchanged",
      "label switches persist after refresh",
      "SVG output matches board labels setting",
      "all matrix cells unchanged by toggles",
      "existing projects retained",
      "no browser errors",
    ],
  };
  await writeFile(
    "output/deploy/minimal-ui-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (created)
    await page.request
      .delete(origin + "/api/v1/patterns/" + example.patternId)
      .catch(() => {});
  await browser.close();
}
