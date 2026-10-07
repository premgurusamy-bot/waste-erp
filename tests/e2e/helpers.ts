import { expect, type Page } from "@playwright/test";

export const ADMIN = { user: "admin", pass: process.env.E2E_ADMIN_PASSWORD || "Admin@123" };
export const DEMO_PASS = process.env.E2E_DEMO_PASSWORD || "Demo@123";

export async function login(page: Page, user = ADMIN.user, pass = ADMIN.pass) {
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(user);
  await page.getByLabel(/^Password/).fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Select an <option> whose label contains the given text. */
export async function choose(page: Page, label: string | RegExp, text: string) {
  const re = typeof label === "string" ? new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) : label;
  const select = page.getByLabel(re).first();
  await expect(select.locator("option", { hasText: text }).first()).toBeAttached();
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  await select.selectOption(value!);
}

export async function toast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
