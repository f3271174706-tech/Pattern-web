import { test, expect } from "@playwright/test";
import { legacyPattern } from "../fixtures/legacy-pattern";
test("legacy upload previews HEX conflicts and preserves exact original JSON in both color modes", async ({ page }) => {
  await page.goto("/");
  for (const mode of ["mard221", "source"]) {
    const source = legacyPattern(); source.name = `旧版 ${mode} 验收`;
    const raw = JSON.stringify(source, null, 4);
    await page.getByRole("button", { name: "导入新图纸" }).click();
    await page.getByLabel("JSON 图纸文件").setInputFiles({ name: "pattern.json", mimeType: "application/json", buffer: Buffer.from(raw) });
    await expect(page.getByText("2 个色号的 HEX 与指定 MARD 色卡不同")).toBeVisible();
    await page.getByText("2 个色号的 HEX 与指定 MARD 色卡不同").click();
    await expect(page.locator(".import-color-diff")).toContainText("#FEFFFF");
    await page.getByLabel("导入色值", { exact: true }).selectOption(mode);
    const response = page.waitForResponse(r => r.url().endsWith("/api/v1/patterns") && r.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "导入图纸", exact: true }).click();
    const imported = await (await response).json();
    await expect(page.getByRole("heading", { name: source.name, exact: true })).toBeVisible();
    expect(imported.pattern.grid.cells).toEqual(source.grid);
    const stats = await (await page.request.get(`/api/v1/patterns/${imported.pattern.patternId}/stats`)).json();
    expect(stats.beadCount).toBe(5);
    expect(imported.pattern.palette.colors.H2.hex).toBe(mode === "mard221" ? "#FEFFFF" : "#FFFFFF");
    const archive = imported.archives[0];
    const original = await page.request.get(`/api/v1/patterns/${imported.pattern.patternId}/archives/${archive.id}`);
    expect(await original.text()).toBe(raw);
    await page.request.delete(`/api/v1/patterns/${imported.pattern.patternId}`);
  }
});
