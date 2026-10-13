import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fittedCell } from "./canvas-helpers";
test("minimal controls persist labels, group palette by actual usage and preserve canvas editing", async ({
  page,
  request,
}) => {
  const p = JSON.parse(
    readFileSync(
      new URL("../../examples/mard-demo-3x2.json", import.meta.url),
      "utf8",
    ),
  );
  p.patternId = "minimal-" + randomUUID();
  p.title = "极简界面验收";
  await request.post("/api/v1/patterns", { data: p });
  // Observe the actual canvas draw calls, including the text hidden by default.
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.fillText;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    (window as unknown as { canvasLabels: string[] }).canvasLabels = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth?,
    ) {
      (window as unknown as { canvasLabels: string[] }).canvasLabels.push(text);
      if (maxWidth === undefined) return draw.call(this, text, x, y);
      return draw.call(this, text, x, y, maxWidth);
    };
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      (window as unknown as { canvasLabels: string[] }).canvasLabels = [];
      return clear.apply(this, args);
    };
  });
  await page.goto("/");
  await page.getByRole("button").filter({ hasText: p.title }).click();
  await expect(
    page.getByRole("heading", { name: "图纸信息", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("精确定位", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("X 坐标", { exact: true })).toHaveCount(0);
  await expect(page.getByText("JSON 权威数据源", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("每颗珠子，精确可追溯", { exact: true }),
  ).toHaveCount(0);
  const labels = () =>
    page.evaluate(
      () => (window as unknown as { canvasLabels: string[] }).canvasLabels,
    );
  const board = page.getByRole("switch", { name: "拼板编号", exact: true }),
    codes = page.getByRole("switch", { name: "显示色号", exact: true });
  await expect(board).toHaveAttribute("aria-checked", "false");
  await expect(codes).toHaveAttribute("aria-checked", "false");
  expect(await labels()).not.toContain("B1-1");
  const used = page.getByLabel("图纸已用颜色", { exact: true });
  const unused = page.getByLabel("剩余颜色", { exact: true });
  expect(await used.locator("button").count()).toBe(2);
  expect(await unused.locator("button").count()).toBe(219);
  await expect(
    used.getByRole("button", { name: "选择色号 A1", exact: true }),
  ).toContainText("3");
  await expect(
    unused.locator(".palette-group").first().locator("summary"),
  ).toContainText("A");
  await codes.click();
  await expect(page.locator(".revision-chip")).toHaveText("v2");
  await expect.poll(labels).toContain("A1");
  await board.click();
  await expect(page.locator(".revision-chip")).toHaveText("v3");
  await expect.poll(labels).toContain("B1-1");
  await page.reload();
  await expect(codes).toHaveAttribute("aria-checked", "true");
  await expect(board).toHaveAttribute("aria-checked", "true");
  let current = await (
    await request.get(`/api/v1/patterns/${p.patternId}`)
  ).json();
  expect(current.pattern.grid.cells).toEqual(p.grid.cells);
  const svg = await (
    await request.get(`/api/v1/patterns/${p.patternId}/exports/svg?revision=3`)
  ).text();
  expect(svg).toContain(">B1-1</text>");
  await board.click();
  await expect(page.locator(".revision-chip")).toHaveText("v4");
  await expect.poll(labels).not.toContain("B1-1");
  await page.getByLabel("搜索色卡", { exact: true }).fill("H2");
  await unused
    .getByRole("button", { name: "选择色号 H2", exact: true })
    .click();
  const target = await fittedCell(page, 3, 2, 3, 1);
  await target.canvas.click({ position: target.position });
  await expect(page.locator(".revision-chip")).toHaveText("v5");
  await expect(
    used.getByRole("button", { name: "选择色号 H2", exact: true }),
  ).toBeVisible();
  await expect(
    unused.getByRole("button", { name: "选择色号 H2", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("搜索色卡", { exact: true }).fill("");
  expect(await used.locator("button").count()).toBe(3);
  expect(await unused.locator("button").count()).toBe(218);
  current = await (await request.get(`/api/v1/patterns/${p.patternId}`)).json();
  expect(current.pattern.grid.cells).toEqual([
    ["A1", "A1", "H2"],
    ["G7", "A1", "G7"],
  ]);
  await request.delete(`/api/v1/patterns/${p.patternId}`);
});
