import { test, expect } from "@playwright/test";
import { createSmallDemo } from "../../packages/core/src/demo";
import { randomUUID } from "node:crypto";
test("dense 200×200 pattern keeps 40,000 exact beads while zooming and panning", async ({
  page,
  request,
}) => {
  const p = createSmallDemo();
  p.patternId = "dense-" + randomUUID();
  p.title = "密集 200×200 性能验收";
  p.grid.width = p.grid.height = 200;
  p.grid.cells = Array.from({ length: 200 }, (_, y) =>
    Array.from({ length: 200 }, (_, x) => ((x + y) % 2 ? "C01" : "C02")),
  );
  p.layout.board.width = p.layout.board.height = 50;
  const imported = await request.post("/api/v1/patterns", { data: p });
  expect(imported.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button").filter({ hasText: p.title }).click();
  await page.getByRole("button", { name: "材料统计", exact: true }).click();
  await expect(page.locator(".materials-total>span")).toHaveText("40,000");
  const canvas = page.getByTestId("pattern-canvas"),
    box = (await canvas.boundingBox())!,
    start = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 150,
    box.y + box.height / 2 + 80,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  expect(Date.now() - start).toBeLessThan(7000);
  const stats = await (
    await request.get(`/api/v1/patterns/${p.patternId}/stats`)
  ).json();
  expect(stats.beadCount).toBe(40000);
  expect(stats.emptyCount).toBe(0);
  expect(stats.colors.map((c: { count: number }) => c.count)).toEqual([
    20000, 20000,
  ]);
  expect(stats.boards).toHaveLength(16);
  await page.screenshot({ path: "output/dense-200x200.png" });
});
