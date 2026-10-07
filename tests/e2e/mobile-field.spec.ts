import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("field screen works on a phone", async ({ page }) => {
  await login(page);
  await page.goto("/field");
  await expect(page.getByRole("heading", { name: "Today's Tasks" })).toBeVisible();
  // No horizontal scrolling on the field screen
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const collect = page.getByRole("main").getByRole("link", { name: /^Collect/ }).first();
  if (await collect.count()) {
    await collect.click();
    await expect(page.getByLabel(/^Actual Quantity \(KG\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Collection" })).toBeVisible();
  }
  // Sidebar is collapsed behind the menu button on mobile
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" })).toBeVisible();
});
