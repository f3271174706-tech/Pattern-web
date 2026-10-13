import type { Page } from "@playwright/test";
export async function fittedCell(
  page: Page,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const canvas = page.getByTestId("pattern-canvas"),
    box = (await canvas.boundingBox())!;
  const zoom = Math.min(
    3,
    Math.max(
      0.15,
      Math.min(
        (box.width - 100) / (width * 16),
        (box.height - 100) / (height * 16),
      ),
    ),
  );
  const cell = 16 * zoom;
  return {
    canvas,
    box,
    position: {
      x: (box.width - width * cell) / 2 + (x - 0.5) * cell,
      y: (box.height - height * cell) / 2 + (y - 0.5) * cell,
    },
  };
}
