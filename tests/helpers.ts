import { prisma } from "@/lib/db";
import { ROLE_DEFINITIONS } from "@/lib/permissions";
import type { Ctx } from "@/server/context";
import { createEntity } from "@/server/services/masters";
import { addRate, createContract } from "@/server/services/contracts";
import { todayISO } from "@/lib/utils";

const USER_FOR_ROLE: Record<string, string> = { ADMIN: "admin", MANAGEMENT: "mgmt", OPERATIONS: "ops", WEIGHBRIDGE: "weigh", PROCESSING: "process", SALES: "sales", ACCOUNTS: "accounts" };

/** Operation context for a seeded user of the given role. */
export async function ctxFor(role: keyof typeof USER_FOR_ROLE): Promise<Ctx> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username: USER_FOR_ROLE[role] } });
  const perms = ROLE_DEFINITIONS.find((r) => r.code === role)!.permissions;
  return { userId: user.id, username: user.username, permissions: new Set(perms), ip: "test" };
}

let n = 0;
export const uniq = (p: string) => `${p} ${Date.now().toString(36)}${n++}`;

export async function ids() {
  const [wt, loc, acc, gst18, cat] = await Promise.all([
    prisma.wasteType.findMany(),
    prisma.location.findMany(),
    prisma.ledgerAccount.findMany(),
    prisma.gstRate.findUniqueOrThrow({ where: { name: "GST 18%" } }),
    prisma.expenseCategory.findMany(),
  ]);
  return {
    wasteType: (code: string) => wt.find((w) => w.code === code)!.id,
    location: (code: string) => loc.find((l) => l.code === code)!.id,
    account: (code: string) => acc.find((a) => a.code === code)!.id,
    gst18: gst18.id,
    category: (code: string) => cat.find((c) => c.code === code)!.id,
  };
}

/** A customer with one site, a vehicle and a driver, ready for operations. */
export async function fixture(admin: Ctx, opts: { gstin?: string } = {}) {
  const I = await ids();
  const customer = await createEntity(admin, "customer", { name: uniq("Test Customer"), gstin: opts.gstin, creditDays: 30, status: "ACTIVE" });
  const site = await createEntity(admin, "site", { customerId: customer.id, name: uniq("Site"), defaultWasteTypeId: I.wasteType("DRY"), frequency: "DAILY", status: "ACTIVE" });
  const vehicle = await createEntity(admin, "vehicle", { number: `TN ${10 + Math.floor(Math.random() * 89)} ZZ ${1000 + Math.floor(Math.random() * 8999)}`, type: "Compactor", capacityKg: 6000, standardTareKg: 5100, status: "ACTIVE" });
  const driver = await createEntity(admin, "driver", { name: uniq("Driver"), licenceNumber: uniq("LIC").replace(/\s/g, ""), status: "ACTIVE" });
  return { I, customer, site, vehicle, driver };
}

export async function weightContract(admin: Ctx, customerId: string, rate: number, unit: "KG" | "TONNE" = "KG", from = "2026-01-01") {
  const I = await ids();
  const c = await createContract(admin, { customerId, title: "Test contract", startDate: from, status: "ACTIVE", paymentTermsDays: 30 });
  const r = await addRate(admin, { contractId: c.id, billingMethod: "WEIGHT", rate, unit, taxTreatment: "TAXABLE", gstRateId: I.gst18, effectiveFrom: from });
  return { contract: c, rate: r };
}

export const at = (date: string, time = "10:00") => `${date}T${time}`;
export const today = () => todayISO();
