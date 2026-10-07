import { expect, test } from "@playwright/test";
import { DEMO_PASS, login } from "./helpers";

test("operations user cannot open finance pages and sees only permitted menu", async ({ page }) => {
  await login(page, "ops", DEMO_PASS);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pickup Requests" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Billing & Invoices" })).toHaveCount(0);
  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  const res = await page.request.get("/api/reports/profitability/export?format=csv");
  expect(res.status()).toBe(403);
});

test("unauthenticated users are redirected to sign in", async ({ page }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login/);
  const api = await page.request.get("/api/reports/weighment/export");
  expect(api.status()).toBe(401);
});

test("wrong password is rejected with a friendly message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill("no-such-user");
  await page.getByLabel(/^Password/).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
});
