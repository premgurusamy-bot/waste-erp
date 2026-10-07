/* Base configuration required by the application (idempotent). */
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { MODULES, ROLE_DEFINITIONS, ACTION_LABELS } from "@/lib/permissions";
import { SEQUENCE_DEFAULTS } from "../numbering";

export const LEDGER_ACCOUNTS: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE"; subType?: string }[] = [
  { code: "1000", name: "Cash in Hand", type: "ASSET", subType: "CASH" },
  { code: "1010", name: "Bank - Current Account", type: "ASSET", subType: "BANK" },
  { code: "1100", name: "Accounts Receivable - Customers", type: "ASSET", subType: "RECEIVABLE" },
  { code: "1110", name: "Accounts Receivable - Buyers", type: "ASSET", subType: "RECEIVABLE" },
  { code: "1300", name: "GST Input - CGST", type: "ASSET", subType: "GST_INPUT" },
  { code: "1301", name: "GST Input - SGST", type: "ASSET", subType: "GST_INPUT" },
  { code: "1302", name: "GST Input - IGST", type: "ASSET", subType: "GST_INPUT" },
  { code: "2000", name: "Accounts Payable - Suppliers", type: "LIABILITY", subType: "PAYABLE" },
  { code: "2100", name: "GST Output - CGST", type: "LIABILITY", subType: "GST_OUTPUT" },
  { code: "2101", name: "GST Output - SGST", type: "LIABILITY", subType: "GST_OUTPUT" },
  { code: "2102", name: "GST Output - IGST", type: "LIABILITY", subType: "GST_OUTPUT" },
  { code: "3000", name: "Capital Account", type: "EQUITY", subType: "CAPITAL" },
  { code: "4000", name: "Waste Management Service Income", type: "INCOME", subType: "SALES" },
  { code: "4100", name: "Recyclable Material Sales", type: "INCOME", subType: "SALES" },
  { code: "4900", name: "Round Off", type: "INCOME", subType: "ROUND_OFF" },
  { code: "5000", name: "Purchases - Materials & Supplies", type: "EXPENSE", subType: "PURCHASE" },
  { code: "5100", name: "Fuel Expense", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5110", name: "Labour Charges", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5120", name: "Vehicle Maintenance", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5130", name: "Electricity", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5140", name: "Rent", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5150", name: "Processing Expenses", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5160", name: "Transport Charges", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5170", name: "Office Expenses", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5180", name: "Repairs", type: "EXPENSE", subType: "EXPENSE" },
  { code: "5190", name: "Other Expenses", type: "EXPENSE", subType: "EXPENSE" },
];

const EXPENSE_CATEGORIES = [
  ["FUEL", "Fuel", "5100"],
  ["LABOUR", "Labour", "5110"],
  ["VEHICLE_MAINT", "Vehicle Maintenance", "5120"],
  ["ELECTRICITY", "Electricity", "5130"],
  ["RENT", "Rent", "5140"],
  ["PROCESSING", "Processing", "5150"],
  ["TRANSPORT", "Transport", "5160"],
  ["OFFICE", "Office", "5170"],
  ["REPAIRS", "Repairs", "5180"],
  ["OTHER", "Other", "5190"],
] as const;

export const WASTE_CATEGORIES = [
  ["WET", "Wet / Biodegradable"],
  ["DRY", "Dry Waste"],
  ["RECYCLABLE", "Recyclable"],
  ["ORGANIC", "Organic"],
  ["MIXED", "Mixed / General"],
  ["INERT", "Inert / Non-recyclable"],
] as const;

export const WASTE_TYPES: [code: string, name: string, cat: string, recyclable: boolean][] = [
  ["WET", "Wet Waste", "WET", false],
  ["DRY", "Dry Waste", "DRY", true],
  ["PLASTIC", "Plastic", "RECYCLABLE", true],
  ["PAPER", "Paper", "RECYCLABLE", true],
  ["CARDBOARD", "Cardboard", "RECYCLABLE", true],
  ["METAL", "Metal", "RECYCLABLE", true],
  ["GLASS", "Glass", "RECYCLABLE", true],
  ["ORGANIC", "Organic Waste", "ORGANIC", false],
  ["MIXED", "Mixed Waste", "MIXED", false],
  ["OTHER", "Other", "INERT", false],
];

export const RECOVERED_ITEMS: [code: string, name: string, wt: string | null, hsn: string, gst: string, saleRate: number][] = [
  ["RCV-PLASTIC", "Recovered Plastic (Baled)", "PLASTIC", "3915", "GST 18%", 22],
  ["RCV-PAPER", "Recovered Paper", "PAPER", "4707", "GST 5%", 9],
  ["RCV-CARDBOARD", "Recovered Cardboard", "CARDBOARD", "4707", "GST 5%", 11],
  ["RCV-METAL", "Recovered Metal Scrap", "METAL", "7204", "GST 18%", 32],
  ["RCV-GLASS", "Recovered Glass Cullet", "GLASS", "7001", "GST 18%", 3],
  ["RCV-COMPOST", "Compost (from organic waste)", "ORGANIC", "3101", "GST 0%", 6],
];

export async function seedBase(prisma: PrismaClient, opts: { adminPassword: string }) {
  // Permissions & roles
  for (const m of MODULES) {
    for (const a of m.actions) {
      const code = `${m.key}.${a}`;
      await prisma.permission.upsert({
        where: { code },
        update: { module: m.key, action: a, description: `${m.label}: ${ACTION_LABELS[a]}` },
        create: { code, module: m.key, action: a, description: `${m.label}: ${ACTION_LABELS[a]}` },
      });
    }
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const r of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, isSystem: true },
      create: { code: r.code, name: r.name, description: r.description, isSystem: true },
    });
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (existing === 0 || r.code === "ADMIN") {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: r.permissions.map((c) => ({ roleId: role.id, permissionId: perms.get(c)! })) });
    }
  }

  // Company, branch, locations
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: "GreenCycle Waste Management (DEMO)",
        legalName: "GreenCycle Waste Management Private Limited",
        gstin: "33AABCG1234K1Z5",
        pan: "AABCG1234K",
        stateCode: "33",
        stateName: "Tamil Nadu",
        address: "SF No. 120, Industrial Estate Road, Kurichi",
        city: "Coimbatore",
        pincode: "641021",
        phone: "0422-2345678",
        email: "accounts@greencycle.example",
        bankName: "State Bank of India",
        bankAccountNo: "00000012345678901",
        bankIfsc: "SBIN0000001",
        invoiceFooter: "Thank you for keeping our city clean. Payment by NEFT/RTGS to the account above.",
      },
    });
  }
  const branch = await prisma.branch.upsert({
    where: { code: "CBE" },
    update: {},
    create: { code: "CBE", name: "Coimbatore Main Facility", companyId: company.id, address: company.address },
  });
  await prisma.location.upsert({ where: { code: "YARD-1" }, update: {}, create: { code: "YARD-1", name: "Receiving Yard", type: "YARD", branchId: branch.id } });
  await prisma.location.upsert({ where: { code: "MRF-1" }, update: {}, create: { code: "MRF-1", name: "Material Recovery Facility", type: "PROCESSING", branchId: branch.id } });
  await prisma.location.upsert({ where: { code: "STORE-1" }, update: {}, create: { code: "STORE-1", name: "Recyclables Store", type: "STORE", branchId: branch.id } });

  // GST rates & settings (rates are data, configurable by admin)
  for (const [name, rate] of [["GST 0%", 0], ["GST 5%", 5], ["GST 12%", 12], ["GST 18%", 18], ["GST 28%", 28]] as const) {
    await prisma.gstRate.upsert({ where: { name }, update: {}, create: { name, rate } });
  }
  const gst18 = await prisma.gstRate.findUniqueOrThrow({ where: { name: "GST 18%" } });
  await prisma.gstSetting.upsert({
    where: { companyId: company.id },
    update: {},
    create: { companyId: company.id, gstEnabled: true, defaultServiceSac: "999432", defaultServiceRateId: gst18.id, defaultGoodsRateId: gst18.id, roundOffInvoices: true },
  });

  // Chart of accounts & expense categories
  for (const a of LEDGER_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({ where: { code: a.code }, update: {}, create: { ...a, isSystem: true } });
  }
  for (const [code, name, acc] of EXPENSE_CATEGORIES) {
    const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: acc } });
    await prisma.expenseCategory.upsert({ where: { code }, update: {}, create: { code, name, accountId: account.id } });
  }

  // Waste master
  for (const [code, name] of WASTE_CATEGORIES) {
    await prisma.wasteCategory.upsert({ where: { code }, update: {}, create: { code, name } });
  }
  const cats = new Map((await prisma.wasteCategory.findMany()).map((c) => [c.code, c.id]));
  for (const [code, name, cat, recyclable] of WASTE_TYPES) {
    const wt = await prisma.wasteType.upsert({
      where: { code },
      update: {},
      create: { code, name, categoryId: cats.get(cat)!, isRecyclable: recyclable, unit: "KG" },
    });
    await prisma.inventoryItem.upsert({
      where: { code: `RAW-${code}` },
      update: {},
      create: { code: `RAW-${code}`, name: `${name} (Unprocessed)`, itemType: "RAW", wasteTypeId: wt.id, unit: "KG" },
    });
  }
  const wts = new Map((await prisma.wasteType.findMany()).map((w) => [w.code, w.id]));
  const rates = new Map((await prisma.gstRate.findMany()).map((r) => [r.name, r.id]));
  for (const [code, name, wt, hsn, gst, saleRate] of RECOVERED_ITEMS) {
    await prisma.inventoryItem.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        itemType: "RECOVERED",
        wasteTypeId: wt ? wts.get(wt) : null,
        unit: "KG",
        hsnCode: hsn,
        gstRateId: rates.get(gst),
        isSaleable: true,
        defaultSaleRate: saleRate,
        reorderLevel: 200,
      },
    });
  }
  await prisma.inventoryItem.upsert({
    where: { code: "REJECT" },
    update: {},
    create: { code: "REJECT", name: "Rejected Waste (for disposal)", itemType: "REJECT", unit: "KG" },
  });

  // Number sequences & settings
  for (const [key, def] of Object.entries(SEQUENCE_DEFAULTS)) {
    await prisma.numberSequence.upsert({ where: { key }, update: {}, create: { key, ...def } });
  }
  await prisma.setting.upsert({ where: { key: "processing.lossAlertPercent" }, update: {}, create: { key: "processing.lossAlertPercent", value: "65", description: "Raise an alert when process loss exceeds this % of input (composting moisture loss is normally 50-60%)" } });
  await prisma.setting.upsert({ where: { key: "documents.expiryWarnDays" }, update: {}, create: { key: "documents.expiryWarnDays", value: "30", description: "Days before expiry to warn about vehicle/driver documents" } });

  // Administrator
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!admin) {
    await prisma.user.create({
      data: {
        username: "admin",
        name: "System Administrator",
        email: "admin@greencycle.example",
        passwordHash: await bcrypt.hash(opts.adminPassword, 12),
        branchId: branch.id,
        roles: { create: [{ roleId: adminRole.id }] },
      },
    });
  }
}

export async function seedDemoUsers(prisma: PrismaClient, password: string) {
  const users: [string, string, string][] = [
    ["mgmt", "Meera (Management)", "MANAGEMENT"],
    ["ops", "Arun (Operations)", "OPERATIONS"],
    ["weigh", "Karthik (Weighbridge)", "WEIGHBRIDGE"],
    ["process", "Divya (Processing)", "PROCESSING"],
    ["sales", "Ravi (Sales/Purchase)", "SALES"],
    ["accounts", "Lakshmi (Accounts)", "ACCOUNTS"],
  ];
  const hash = await bcrypt.hash(password, 12);
  for (const [username, name, roleCode] of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, name, passwordHash: hash, roles: { create: [{ roleId: role.id }] } },
    });
  }
}
