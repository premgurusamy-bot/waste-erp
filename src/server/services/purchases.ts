import { prisma, type Tx } from "@/lib/db";
import { addDays, dateOnly, num, round2, todayISO } from "@/lib/utils";
import { expenseSchema, fuelSchema, journalSchema, maintenanceSchema, purchaseSchema } from "@/lib/validation";
import { ACC, postJournal, reverseJournal } from "../accounting";
import { audit } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { computeTax, getGstContext, roundOffTotal, sumTaxes } from "../gst";
import { postStock, reverseStock } from "../inventory";
import { nextNumber } from "../numbering";

// ----------------------------- PURCHASES --------------------------------

export async function createPurchase(ctx: Ctx, input: unknown) {
  assertCan(ctx, "purchases.manage");
  const i = purchaseSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: i.supplierId } });
    if (!supplier || supplier.status !== "ACTIVE") throw new AppError("Select an active supplier.", { supplierId: "Invalid supplier" });
    if (i.items.some((l) => l.itemId) && !i.locationId) throw new AppError("Select the receiving location for stock items.", { locationId: "Required for stock items" });
    const gst = await getGstContext(tx);
    const interState = gst.isInterState(supplier.gstin, supplier.stateCode);
    const lines = i.items.map((l) => ({ l, tax: computeTax(l.quantity * l.rate, l.gstRate ?? 0, interState, gst.gstEnabled) }));
    const totals = sumTaxes(lines.map((x) => x.tax));
    const { total, roundOff } = roundOffTotal(totals.gross, gst.roundOff);
    const date = dateOnly(i.date);
    const number = await nextNumber(tx, "PURCHASE", date);
    const p = await tx.purchase.create({
      data: {
        number,
        date,
        supplierId: supplier.id,
        billNumber: i.billNumber ?? null,
        billDate: i.billDate ? dateOnly(i.billDate) : null,
        locationId: i.locationId ?? null,
        isInterState: interState,
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff,
        total,
        dueDate: addDays(date, supplier.paymentTermsDays),
        remarks: i.remarks ?? null,
        createdById: ctx.userId,
        items: {
          create: lines.map(({ l, tax }) => ({
            itemId: l.itemId ?? null,
            description: l.description,
            hsnCode: l.hsnCode ?? null,
            quantity: l.quantity,
            unit: l.unit,
            rate: l.rate,
            ...tax,
          })),
        },
      },
    });
    for (const { l } of lines) {
      if (!l.itemId) continue;
      await postStock(tx, ctx, {
        date,
        itemId: l.itemId,
        locationId: i.locationId!,
        quantity: l.quantity,
        txnType: "PURCHASE",
        rate: l.rate,
        refType: "PURCHASE",
        refId: p.id,
        refNumber: number,
        remarks: `Purchased from ${supplier.name}`,
      });
    }
    await postJournal(tx, ctx, {
      date,
      narration: `Purchase ${number} - ${supplier.name}${i.billNumber ? ` (bill ${i.billNumber})` : ""}`,
      sourceType: "PURCHASE",
      sourceId: p.id,
      sourceNumber: number,
      lines: [
        { accountCode: ACC.PURCHASES, debit: totals.subtotal },
        { accountCode: ACC.GST_IN_CGST, debit: totals.cgst },
        { accountCode: ACC.GST_IN_SGST, debit: totals.sgst },
        { accountCode: ACC.GST_IN_IGST, debit: totals.igst },
        { accountCode: ACC.ROUND_OFF, debit: roundOff },
        { accountCode: ACC.AP_SUPPLIERS, credit: total, partyType: "SUPPLIER", partyId: supplier.id },
      ],
    });
    await audit(tx, ctx, { action: "CREATE", module: "purchases", recordId: p.id, recordLabel: `${number} ${supplier.name}`, newValues: { total, items: i.items } });
    return p;
  });
}

export async function cancelPurchase(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "purchases.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.purchase.findUnique({ where: { id } });
    if (!p || p.status === "CANCELLED") throw new AppError("Purchase not found or already cancelled.");
    if (num(p.amountPaid) > 0) throw new AppError("Payments are allocated to this purchase. Cancel them first.");
    await reverseStock(tx, ctx, "PURCHASE", p.id, reason);
    await reverseJournal(tx, ctx, "PURCHASE", p.id, dateOnly(todayISO()), reason);
    const u = await tx.purchase.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "purchases", recordId: id, recordLabel: p.number, oldValues: { status: p.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}

// ----------------------------- EXPENSES ---------------------------------

type ExpenseData = {
  date: string;
  categoryId: string;
  supplierId?: string;
  vehicleId?: string;
  description?: string;
  amount: number;
  gstRate?: number;
  paymentMode: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE" | "CARD" | "CREDIT";
  accountId?: string;
  reference?: string;
  remarks?: string;
};

async function createExpenseInTx(tx: Tx, ctx: Ctx, i: ExpenseData) {
  const category = await tx.expenseCategory.findUnique({ where: { id: i.categoryId }, include: { account: true } });
  if (!category) throw new AppError("Select an expense category.", { categoryId: "Required" });
  const credit = i.paymentMode === "CREDIT";
  if (credit && !i.supplierId) throw new AppError("Supplier is required for credit expenses.", { supplierId: "Required" });
  if (!credit && !i.accountId) throw new AppError("Select the cash/bank account used.", { accountId: "Required" });
  let payAcc = null;
  if (!credit) {
    payAcc = await tx.ledgerAccount.findUnique({ where: { id: i.accountId! } });
    if (!payAcc || !["CASH", "BANK"].includes(payAcc.subType ?? "")) throw new AppError("Select a cash or bank account.", { accountId: "Invalid" });
  }
  const supplier = i.supplierId ? await tx.supplier.findUnique({ where: { id: i.supplierId } }) : null;
  const gst = await getGstContext(tx);
  const interState = gst.isInterState(supplier?.gstin, supplier?.stateCode);
  const tax = computeTax(i.amount, i.gstRate ?? 0, interState, gst.gstEnabled);
  const date = dateOnly(i.date);
  const number = await nextNumber(tx, "EXPENSE", date);
  const e = await tx.expense.create({
    data: {
      number,
      date,
      categoryId: category.id,
      supplierId: i.supplierId ?? null,
      vehicleId: i.vehicleId ?? null,
      description: i.description ?? null,
      amount: tax.taxableValue,
      gstRate: tax.gstRate,
      isInterState: interState,
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: tax.igst,
      total: tax.total,
      paymentMode: i.paymentMode,
      accountId: payAcc?.id ?? null,
      reference: i.reference ?? null,
      amountPaid: credit ? 0 : tax.total,
      paymentStatus: credit ? "UNPAID" : "PAID",
      remarks: i.remarks ?? null,
      createdById: ctx.userId,
    },
  });
  await postJournal(tx, ctx, {
    date,
    narration: `Expense ${number} - ${category.name}${i.description ? `: ${i.description}` : ""}`,
    sourceType: "EXPENSE",
    sourceId: e.id,
    sourceNumber: number,
    lines: [
      category.accountId ? { accountId: category.accountId, debit: tax.taxableValue } : { accountCode: ACC.OTHER_EXPENSES, debit: tax.taxableValue },
      { accountCode: ACC.GST_IN_CGST, debit: tax.cgst },
      { accountCode: ACC.GST_IN_SGST, debit: tax.sgst },
      { accountCode: ACC.GST_IN_IGST, debit: tax.igst },
      credit
        ? { accountCode: ACC.AP_SUPPLIERS, credit: tax.total, partyType: "SUPPLIER" as const, partyId: i.supplierId }
        : { accountId: payAcc!.id, credit: tax.total },
    ],
  });
  await audit(tx, ctx, { action: "CREATE", module: "expenses", recordId: e.id, recordLabel: `${number} ${category.name}`, newValues: { ...i, total: tax.total } });
  return e;
}

export async function createExpense(ctx: Ctx, input: unknown) {
  assertCan(ctx, "expenses.manage");
  const i = expenseSchema.parse(input);
  return prisma.$transaction((tx) => createExpenseInTx(tx, ctx, i as ExpenseData));
}

export async function cancelExpense(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "expenses.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Enter a cancellation reason.");
  return prisma.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id }, include: { allocations: true } });
    if (!e || e.status === "CANCELLED") throw new AppError("Expense not found or already cancelled.");
    if (e.allocations.length) throw new AppError("Supplier payments are allocated to this expense. Cancel them first.");
    await reverseJournal(tx, ctx, "EXPENSE", e.id, dateOnly(todayISO()), reason);
    const u = await tx.expense.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await audit(tx, ctx, { action: "CANCEL", module: "expenses", recordId: id, recordLabel: e.number, oldValues: { status: e.status }, newValues: { status: "CANCELLED", reason } });
    return u;
  });
}

async function categoryByCode(tx: Tx, code: string) {
  const c = await tx.expenseCategory.findUnique({ where: { code } });
  if (!c) throw new AppError(`Expense category ${code} is not configured.`);
  return c;
}

/** Fuel log: records litres/rate and posts the matching Fuel expense in one transaction. */
export async function createFuelEntry(ctx: Ctx, input: unknown) {
  assertCan(ctx, "vehicles.manage");
  const i = fuelSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: i.vehicleId } });
    if (!vehicle) throw new AppError("Invalid vehicle.");
    const amount = round2(i.litres * i.ratePerLitre);
    const cat = await categoryByCode(tx, "FUEL");
    const exp = await createExpenseInTx(tx, ctx, {
      date: i.date,
      categoryId: cat.id,
      vehicleId: vehicle.id,
      supplierId: i.supplierId,
      description: `Fuel ${i.litres} L for ${vehicle.number}${i.fuelStation ? ` at ${i.fuelStation}` : ""}`,
      amount,
      gstRate: 0,
      paymentMode: i.paymentMode,
      accountId: i.accountId,
    });
    return tx.vehicleFuel.create({
      data: {
        vehicleId: vehicle.id,
        driverId: i.driverId ?? null,
        date: dateOnly(i.date),
        litres: i.litres,
        ratePerLitre: i.ratePerLitre,
        amount,
        odometer: i.odometer ?? null,
        fuelStation: i.fuelStation ?? null,
        expenseId: exp.id,
      },
    });
  });
}

export async function createMaintenanceEntry(ctx: Ctx, input: unknown) {
  assertCan(ctx, "vehicles.manage");
  const i = maintenanceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUnique({ where: { id: i.vehicleId } });
    if (!vehicle) throw new AppError("Invalid vehicle.");
    const cat = await categoryByCode(tx, i.maintenanceType === "REPAIR" ? "REPAIRS" : "VEHICLE_MAINT");
    const exp = await createExpenseInTx(tx, ctx, {
      date: i.date,
      categoryId: cat.id,
      vehicleId: vehicle.id,
      supplierId: i.supplierId,
      description: `${i.maintenanceType.replace("_", " ")} - ${vehicle.number}: ${i.description}`,
      amount: i.amount,
      gstRate: 0,
      paymentMode: i.paymentMode,
      accountId: i.accountId,
    });
    return tx.vehicleMaintenance.create({
      data: {
        vehicleId: vehicle.id,
        date: dateOnly(i.date),
        maintenanceType: i.maintenanceType,
        description: i.description,
        supplierId: i.supplierId ?? null,
        amount: i.amount,
        odometer: i.odometer ?? null,
        nextServiceDate: i.nextServiceDate ? dateOnly(i.nextServiceDate) : null,
        expenseId: exp.id,
      },
    });
  });
}

// ----------------------------- JOURNAL ----------------------------------

export async function createManualJournal(ctx: Ctx, input: unknown) {
  assertCan(ctx, "accounts.manage");
  const i = journalSchema.parse(input);
  for (const l of i.lines) {
    if ((l.debit > 0) === (l.credit > 0)) throw new AppError("Each line must have either a debit or a credit amount.");
  }
  return prisma.$transaction(async (tx) => {
    const je = await postJournal(tx, ctx, {
      date: dateOnly(i.date),
      narration: i.narration,
      sourceType: "MANUAL",
      sourceId: "",
      sourceNumber: "Manual",
      lines: i.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
    });
    await audit(tx, ctx, { action: "CREATE", module: "accounts", recordId: je?.id, recordLabel: `Journal ${je?.number}`, newValues: i });
    return je;
  });
}
