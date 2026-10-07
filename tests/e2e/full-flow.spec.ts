import { expect, test } from "@playwright/test";
import { choose, login, toast, todayIST } from "./helpers";

/**
 * Complete simulated transaction through the UI:
 * customer → site → waste type → vehicle → driver → pickup → assign vehicle/driver → collection →
 * weighment (8,540 − 5,100 = 3,440) → processing → recovered stock → sale → invoice → payment →
 * outstanding → dashboard → reports → audit trail.
 */
test("end-to-end business flow", async ({ page }) => {
  const tag = Date.now().toString(36).toUpperCase();
  const customer = `E2E Industries ${tag}`;
  const site = `E2E Plant ${tag}`;
  const wasteCode = `E2E${tag}`.slice(0, 12);
  const wasteName = `E2E Dry Waste ${tag}`;
  const vehicle = `KA 01 E ${String(Date.now()).slice(-4)}`;
  const driver = `E2E Driver ${tag}`;
  const today = todayIST();

  await login(page);

  // 1. Create customer
  await page.goto("/customers/new");
  await page.getByLabel(/^Customer Name/).fill(customer);
  await page.getByLabel(/^GSTIN/).fill("33AAACE1234F1Z5");
  await page.getByLabel(/^Contact Person/).fill("E2E Manager");
  await page.getByLabel(/^Mobile/).fill("9876512345");
  await page.getByRole("button", { name: "Create Customer" }).click();
  await page.waitForURL(/\/customers\/(?!new)[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(customer);
  const customerUrl = page.url();
  const customerId = customerUrl.split("/").pop()!;

  // 3. Create waste type (master data) — before the site so the site can use it
  await page.goto("/masters?tab=waste-types");
  await page.getByRole("button", { name: /New Waste Type/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^Code/).fill(wasteCode);
  await dlg.getByLabel(/^Name/).fill(wasteName);
  await choose(page, "Category", "Dry Waste");
  await dlg.getByRole("button", { name: "Save" }).click();
  await toast(page, "Created");
  await expect(page.getByRole("cell", { name: wasteName })).toBeVisible();

  // 2. Create customer site
  await page.goto(`/sites/new?customerId=${customerId}`);
  await page.getByLabel(/^Site Name/).fill(site);
  await choose(page, "Waste Type", wasteName);
  await page.getByLabel(/^Address/).fill("SIPCOT Phase 2");
  await page.getByRole("button", { name: "Create Site" }).click();
  await page.waitForURL(/\/sites\/(?!new)[a-z0-9]+$/);

  // Commercial terms: contract with a weight-based rate of ₹2.50 / KG
  await page.goto(`/contracts/new?customerId=${customerId}`);
  await page.getByLabel(/^Contract Title/).fill("E2E weight contract");
  await page.getByRole("button", { name: "Create Contract" }).click();
  await page.waitForURL(/\/contracts\/(?!new)[a-z0-9]+$/);
  await page.getByRole("button", { name: "Add Rate" }).click();
  await page.getByRole("dialog").getByLabel(/^Rate \(₹\)/).fill("2.5");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await toast(page, "Rate added");
  await expect(page.getByText("₹2.50 / kg")).toBeVisible();

  // 4. Create vehicle
  await page.goto("/vehicles/new");
  await page.getByLabel(/^Vehicle Number/).fill(vehicle);
  await choose(page, "Vehicle Type", "Compactor");
  await page.getByLabel(/^Capacity \(KG\)/).fill("6000");
  await page.getByLabel(/^Standard Tare \(KG\)/).fill("5100");
  await page.getByLabel(/^Insurance Expiry/).fill("2027-12-31");
  await page.getByRole("button", { name: "Create Vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[a-z0-9]+$/);

  // 5. Create driver
  await page.goto("/drivers/new");
  await page.getByLabel(/^Driver Name/).fill(driver);
  await page.getByLabel(/^Licence Number/).fill(`TN${tag}`);
  await page.getByLabel(/^Licence Expiry/).fill("2029-01-01");
  await page.getByRole("button", { name: "Create Driver" }).click();
  await page.waitForURL(/\/drivers\/(?!new)[a-z0-9]+$/);

  // 6. Create pickup
  await page.goto(`/pickups/new?customerId=${customerId}`);
  await choose(page, "Site", site);
  await choose(page, "Waste Type", wasteName);
  await page.getByLabel(/^Estimated Quantity \(KG\)/).fill("3500");
  await page.getByRole("button", { name: "Create Pickup" }).click();
  await page.waitForURL(/\/pickups$/);
  const pickupRow = page.getByRole("row").filter({ hasText: customer });
  await expect(pickupRow).toContainText("Pending");

  // 7–8. Schedule with vehicle and driver
  await pickupRow.getByRole("button", { name: "Schedule" }).click();
  await choose(page, "Vehicle", vehicle);
  await choose(page, "Driver", driver);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await toast(page, "Pickup scheduled");
  await expect(page.getByRole("row").filter({ hasText: customer })).toContainText("Assigned");

  // 9. Start and complete collection from the operations board
  await page.goto(`/schedule?date=${today}`);
  const schedRow = page.getByRole("row").filter({ hasText: customer });
  await schedRow.getByRole("button", { name: "Start" }).click();
  await toast(page, "Collection started");
  await page.getByRole("row").filter({ hasText: customer }).getByRole("link", { name: "Complete" }).click();
  await page.getByLabel(/^Actual Quantity \(KG\)/).fill("3450");
  await page.getByRole("button", { name: "Submit Collection" }).click();
  await toast(page, "Collection recorded");
  await page.waitForURL(/\/schedule/);
  await expect(page.getByRole("row").filter({ hasText: customer })).toContainText("Completed");

  // 10–11. Weighment: gross 8,540, tare 5,100 → net 3,440 calculated automatically
  await page.goto("/collections");
  await page.getByRole("row").filter({ hasText: customer }).getByRole("link", { name: "Gate In" }).click();
  await page.getByLabel(/^Gross Weight \(KG\)/).fill("8540");
  await page.getByLabel(/^Weighbridge Slip No\./).fill(`E2E-${tag}`);
  await page.getByRole("button", { name: "Record Gate In" }).click();
  await page.waitForURL(/\/weighments\/(?!new)[a-z0-9]+$/);
  await page.getByLabel(/^Tare Weight \(KG\)/).fill("5100");
  await expect(page.getByTestId("net-weight")).toHaveText("3,440");
  await page.getByRole("button", { name: "Complete Gate-out" }).click();
  await toast(page, /Net weight 3,440 KG/);
  await expect(page.getByTestId("w-net")).toContainText("3,440");

  // 12–14. Process the received waste into recovered material
  await page.goto("/processing/new");
  await page.getByLabel(/^Batch Number/).fill(`E2E-${tag}`);
  await page.getByLabel(/^Input · received waste material 1/).selectOption({ label: `${wasteName} (Unprocessed) (RAW-${wasteCode})` });
  await expect(page.getByText("Available: 3,440 KG")).toBeVisible();
  await page.getByLabel(/^Input · received waste quantity 1/).fill("3440");
  await page.getByLabel(/^Output · recovered material material 1/).selectOption({ label: "Recovered Plastic (Baled) (RCV-PLASTIC)" });
  await page.getByLabel(/^Output · recovered material quantity 1/).fill("2000");
  await page.getByLabel(/^Rejected Quantity \(KG\)/).fill("1000");
  await page.getByLabel(/^Process Loss \(KG\)/).fill("400");
  await expect(page.getByTestId("balance")).toContainText("Difference 40");
  await page.getByRole("button", { name: "Post Processing Batch" }).click();
  await expect(page.getByText(/Input must equal Output \+ Rejected \+ Loss/)).toBeVisible();
  await page.getByLabel(/^Process Loss \(KG\)/).fill("440");
  await expect(page.getByTestId("balance")).toContainText("Balanced");
  await page.getByRole("button", { name: "Post Processing Batch" }).click();
  await page.waitForURL(/\/processing\/(?!new)[a-z0-9]+$/);
  const procNo = (await page.getByRole("heading", { level: 1 }).textContent())!.match(/PROC-\d+/)![0];
  await expect(page.getByText("Recovered Plastic (Baled)").first()).toBeVisible();

  // 15–16. Sell recovered material; stock is reduced
  await page.goto("/sales/new");
  await choose(page, "Buyer", "Recycle Traders");
  await page.getByLabel(/^Material 1/).selectOption({ label: "Recovered Plastic (Baled)" });
  await page.getByLabel(/^Quantity 1/).fill("1500");
  await page.getByLabel(/^Rate 1/).fill("22");
  await page.getByRole("button", { name: /Save Sale/ }).click();
  await page.waitForURL(/\/sales\/(?!new)[a-z0-9]+$/);
  const saleNo = (await page.getByRole("heading", { level: 1 }).textContent())!.match(/SALE-\d{4}-\d+/)![0];
  await page.goto("/inventory?tab=ledger");
  await page.getByLabel(/^Material/).selectOption({ label: "Recovered Plastic (Baled) (RCV-PLASTIC)" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("row").filter({ hasText: procNo })).toContainText("2,000");
  await expect(page.getByRole("row").filter({ hasText: saleNo })).toContainText("1,500");

  // 17. Generate the customer invoice (3,440 kg × ₹2.50 = ₹8,600 + 18% GST)
  await page.goto(`/invoices/new?customerId=${customerId}`);
  await page.getByLabel(/^Period From/).fill(today);
  await page.getByLabel(/^Period To/).fill(today);
  await page.getByRole("button", { name: "Calculate billable charges" }).click();
  const line = page.getByTestId("bill-line");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("3,440 KG");
  await expect(line).toContainText("₹8,600.00");
  await page.getByRole("button", { name: "Create Invoice" }).click();
  await page.waitForURL(/\/invoices\/(?!new)[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Unpaid");
  await expect(page.getByText("₹10,148.00").first()).toBeVisible();
  const pdf = await page.request.get(page.url().replace("/invoices/", "/api/invoices/") + "/pdf");
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // 18. Record payment against the invoice
  await page.goto(`/receipts/new?customerId=${customerId}`);
  await page.getByLabel(/^Amount \(₹\)/).fill("10148");
  await page.getByLabel(/^Reference \(UTR \/ cheque no\.\)/).fill(`UTR${tag}`);
  await page.getByRole("button", { name: /Auto-allocate/ }).click();
  await page.getByRole("button", { name: "Save Receipt" }).click();
  await page.waitForURL(/\/receipts\/(?!new)[a-z0-9]+$/);
  await expect(page.getByText("Paid").first()).toBeVisible();

  // 19. Outstanding is cleared
  await page.goto(customerUrl);
  await expect(page.locator("text=Outstanding").locator("..").getByText("₹0.00")).toBeVisible();

  // 20. Dashboard
  await page.goto("/dashboard?period=today");
  await expect(page.getByRole("heading", { name: "Management Dashboard" })).toBeVisible();
  await expect(page.getByText("Process Flow")).toBeVisible();

  // 21. Reports: weighment register filtered to this customer
  await page.goto(`/reports/weighment?from=${today}&to=${today}&customerId=${customerId}`);
  const table = page.getByTestId("report-table");
  await expect(table).toContainText("8,540");
  await expect(table).toContainText("3,440");
  const xlsx = await page.request.get(`/api/reports/weighment/export?format=xlsx&from=${today}&to=${today}&customerId=${customerId}`);
  expect(xlsx.ok()).toBeTruthy();

  // 22. Audit trail shows the activity
  await page.goto(`/audit?q=${encodeURIComponent(customer)}&from=${today}&to=${today}`);
  await expect(page.getByRole("row").filter({ hasText: "CREATE" }).first()).toBeVisible();
});
