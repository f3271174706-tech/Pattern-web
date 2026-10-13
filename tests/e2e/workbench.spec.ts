import { test, expect } from "@playwright/test";
import { createSmallDemo } from "../../packages/core/src/demo";
import { randomUUID } from "node:crypto";
import { fittedCell } from "./canvas-helpers";
test("complete JSON import → exact edit → statistics → revision → SVG/PDF downloads → persisted undo/redo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "导入新图纸" }).click();
  const p = createSmallDemo();
  p.patternId = "browser-" + randomUUID();
  p.title = "浏览器验收图纸";
  await page.getByLabel("JSON 图纸文件").setInputFiles({
    name: "acceptance.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByText("3 × 2 · custom · 5 颗")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "导入图纸", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "浏览器验收图纸", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "选择色号 C02", exact: true }).click();
  const first = await fittedCell(page, 3, 2, 1, 1);
  await first.canvas.click({ position: first.position });
  await expect(page.locator(".revision-chip")).toHaveText("v2");
  await page.getByRole("button", { name: "材料统计", exact: true }).click();
  await expect(page.locator(".materials-total>span")).toHaveText("5");
  const c02 = page
    .locator(".material-row")
    .filter({ has: page.getByText("C02", { exact: true }) });
  await expect(c02).toContainText("3");
  await expect(c02).toContainText("60.0%");
  await page.getByRole("button", { name: "版本记录", exact: true }).click();
  await page.getByRole("button", { name: "比较差异" }).click();
  await expect(page.getByText("共 1 格差异")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "SVG", exact: true }).click();
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出文件", exact: true }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toContain("-v2.svg");
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出文件", exact: true }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toContain("-v2.pdf");
  await page.reload();
  await expect(page.locator(".revision-chip")).toHaveText("v2");
  await page
    .getByRole("button", { name: "撤销 (Ctrl+Z)", exact: true })
    .click();
  await expect(page.locator(".revision-chip")).toHaveText("v3");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重做 (Ctrl+Y)", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "重做 (Ctrl+Y)", exact: true })
    .click();
  await expect(page.locator(".revision-chip")).toHaveText("v4");
  expect(errors).toEqual([]);
});
test("batch preview can cancel and confirmation changes only the requested rectangle", async ({
  page,
  request,
}) => {
  const p = createSmallDemo();
  p.patternId = "batch-" + randomUUID();
  p.title = "批量验收";
  await request.post("/api/v1/patterns", { data: p });
  await page.goto("/");
  await page.getByRole("button").filter({ hasText: "批量验收" }).click();
  await page.getByRole("button", { name: "批量换色", exact: true }).click();
  await page.getByLabel("批量修改范围").selectOption("rect");
  for (const [key, value] of Object.entries({
    X1: "1",
    Y1: "1",
    X2: "2",
    Y2: "1",
  }))
    await page.getByText(key, { exact: true }).locator("input").fill(value);
  await page.getByLabel("批量原色号").selectOption("C01");
  await page.getByLabel("批量目标色号").selectOption("C02");
  await page.getByRole("button", { name: "预览修改" }).click();
  await expect(
    page.getByRole("button", { name: "确认修改 2 格" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  let stored = await (
    await request.get(`/api/v1/patterns/${p.patternId}`)
  ).json();
  expect(stored.pattern.revision).toBe(1);
  await page.getByRole("button", { name: "预览修改" }).click();
  await page.getByRole("button", { name: "确认修改 2 格" }).click();
  await expect(page.locator(".revision-chip")).toHaveText("v2");
  stored = await (await request.get(`/api/v1/patterns/${p.patternId}`)).json();
  expect(stored.pattern.grid.cells).toEqual([
    ["C02", "C02", null],
    ["C02", "C01", "C02"],
  ]);
});
test("MARD preset, 200×200 canvas zoom/pan, white cells and layout do not corrupt data", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建图纸", exact: true }).click();
  await page
    .getByText("图纸名称", { exact: true })
    .locator("input")
    .fill("MARD 200 性能验收");
  await page
    .getByText("宽度（格）", { exact: true })
    .locator("input")
    .fill("200");
  await page
    .getByText("高度（格）", { exact: true })
    .locator("input")
    .fill("200");
  await page.getByRole("button", { name: "创建图纸", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "MARD 200 性能验收" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择色号 A1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索色卡", { exact: true }).fill("H2");
  await page.getByRole("button", { name: "选择色号 H2", exact: true }).click();
  const first = await fittedCell(page, 200, 200, 1, 1);
  await first.canvas.click({ position: first.position });
  await expect(page.locator(".revision-chip")).toHaveText("v2");
  await page.getByRole("button", { name: "材料统计", exact: true }).click();
  await expect(page.locator(".materials-total>span")).toHaveText("1");
  await page.getByRole("button", { name: "排版", exact: true }).click();
  await page.getByLabel("拼板宽度").fill("50");
  await page.getByLabel("拼板高度").fill("50");
  await page.getByRole("button", { name: "保存排版设置" }).click();
  await expect(page.locator(".revision-chip")).toHaveText("v3");
  const canvas = page.getByTestId("pattern-canvas");
  const box = (await canvas.boundingBox())!;
  const start = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 100,
    box.y + box.height / 2 + 50,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  expect(Date.now() - start).toBeLessThan(5000);
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  const list = await (await request.get("/api/v1/patterns")).json();
  const project = list.find(
    (v: { title: string }) => v.title === "MARD 200 性能验收",
  );
  const current = await (
    await request.get(`/api/v1/patterns/${project.id}`)
  ).json();
  expect(current.pattern.grid.cells[0][0]).toBe("H2");
  expect(current.pattern.palette.colors.H2.hex).toBe("#FEFFFF");
  expect(
    current.pattern.grid.cells.flat().filter((c: unknown) => c !== null),
  ).toHaveLength(1);
  await page.screenshot({ path: "output/workbench-200.png" });
});
test("invalid JSON presents an exact error location and tablet layout remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 850, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "新建图纸", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "新建空白图纸" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  // Use the empty-canvas import, or the sidebar when present.
  const button = page.getByRole("button", { name: "导入新图纸" });
  if (await button.isVisible()) await button.click();
  else {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await button.click();
  }
  const bad = createSmallDemo();
  bad.grid.cells[0][0] = "NO_SUCH_COLOR";
  await page.getByLabel("JSON 图纸文件").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "/grid/cells/0/0",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "导入图纸", exact: true }),
  ).toBeDisabled();
});
test("canvas brush, eraser, eyedropper and rectangle target exact coordinates", async ({
  page,
  request,
}) => {
  const p = createSmallDemo();
  p.patternId = "canvas-" + randomUUID();
  p.title = "画布工具验收";
  await request.post("/api/v1/patterns", { data: p });
  await page.goto("/");
  await page.getByRole("button").filter({ hasText: "画布工具验收" }).click();
  await page.getByLabel("搜索色卡", { exact: true }).fill("WHITE");
  await page
    .getByRole("button", { name: "选择色号 WHITE", exact: true })
    .click();
  const third = await fittedCell(page, 3, 2, 3, 1),
    { canvas, box } = third;
  await canvas.click({ position: third.position });
  await expect(page.locator(".revision-chip")).toHaveText("v2");
  let current = await (
    await request.get(`/api/v1/patterns/${p.patternId}`)
  ).json();
  expect(current.pattern.grid.cells[0][2]).toBe("WHITE");
  expect(current.pattern.grid.cells[0][0]).toBe("C01");
  await page.getByRole("button", { name: "橡皮擦 (E)", exact: true }).click();
  await canvas.click({ position: third.position });
  await expect(page.locator(".revision-chip")).toHaveText("v3");
  await page.getByLabel("搜索色卡", { exact: true }).fill("");
  const first = await fittedCell(page, 3, 2, 1, 1);
  await page.getByRole("button", { name: "吸管 (I)", exact: true }).click();
  await canvas.click({ position: first.position });
  await expect(
    page.getByRole("button", { name: "选择色号 C01", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "矩形选区 (R)", exact: true }).click();
  await page.mouse.move(box.x + first.position.x, box.y + first.position.y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + first.position.x + 48,
    box.y + first.position.y + 48,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect(page.locator(".inspector-footer")).toContainText(
    "X 1–2 · Y 1–2",
  );
  await page.getByRole("button", { name: "编辑所选区域", exact: true }).click();
  await page.getByLabel("批量原色号").selectOption("C01");
  await page.getByLabel("批量目标色号").selectOption("C02");
  await page.getByRole("button", { name: "预览修改" }).click();
  await page.getByRole("button", { name: "确认修改 3 格" }).click();
  await expect(page.locator(".revision-chip")).toHaveText("v4");
  current = await (await request.get(`/api/v1/patterns/${p.patternId}`)).json();
  expect(current.pattern.grid.cells).toEqual([
    ["C02", "C02", null],
    ["C02", "C02", "C02"],
  ]);
});
