import "server-only";
import { prisma } from "@/lib/db";
import type { Option } from "@/components/forms/entity-form";

export async function customerOptions(includeInactive = false): Promise<Option[]> {
  const rows = await prisma.customer.findMany({ where: includeInactive ? {} : { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } });
  return rows.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }));
}
export async function siteOptions(): Promise<Option[]> {
  const rows = await prisma.customerSite.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, customerId: true } });
  return rows.map((r) => ({ value: r.id, label: r.name, parent: r.customerId }));
}
export async function wasteTypeOptions(): Promise<Option[]> {
  const rows = await prisma.wasteType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
export async function wasteCategoryOptions(): Promise<Option[]> {
  const rows = await prisma.wasteCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
export async function vehicleOptions(all = false): Promise<Option[]> {
  const rows = await prisma.vehicle.findMany({ where: all ? {} : { status: "ACTIVE" }, orderBy: { number: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.number} · ${r.type}` }));
}
export async function driverOptions(): Promise<Option[]> {
  const rows = await prisma.driver.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }));
}
export async function buyerOptions(): Promise<Option[]> {
  const rows = await prisma.buyer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
export async function supplierOptions(): Promise<Option[]> {
  const rows = await prisma.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
export async function locationOptions(): Promise<Option[]> {
  const rows = await prisma.location.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }));
}
export async function branchOptions(): Promise<Option[]> {
  const rows = await prisma.branch.findMany({ orderBy: { code: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
export async function gstRateOptions(): Promise<Option[]> {
  const rows = await prisma.gstRate.findMany({ where: { active: true }, orderBy: { rate: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.name}` }));
}
export async function cashBankOptions(): Promise<Option[]> {
  const rows = await prisma.ledgerAccount.findMany({ where: { active: true, subType: { in: ["CASH", "BANK"] } }, orderBy: { code: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` }));
}
export async function ledgerOptions(): Promise<Option[]> {
  const rows = await prisma.ledgerAccount.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` }));
}
export async function expenseCategoryOptions(): Promise<Option[]> {
  const rows = await prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
export async function itemOptions(where: { itemType?: any; isSaleable?: boolean } = {}): Promise<Option[]> {
  const rows = await prisma.inventoryItem.findMany({ where: { active: true, ...where }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }));
}
export async function contractOptions(customerId?: string): Promise<Option[]> {
  const rows = await prisma.contract.findMany({ where: { status: "ACTIVE", customerId }, include: { customer: true }, orderBy: { number: "desc" } });
  return rows.map((r) => ({ value: r.id, label: `${r.number} · ${r.customer.name}`, parent: r.customerId }));
}
