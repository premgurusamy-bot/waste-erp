import { prisma, type Tx } from "@/lib/db";
import { dateOnly } from "@/lib/utils";
import * as v from "@/lib/validation";
import { audit, diff } from "../audit";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { nextNumber } from "../numbering";

const d = (s?: string) => (s ? dateOnly(s) : null);
const n = <T>(x: T | undefined) => (x === undefined ? null : x);

type EntityDef = {
  model: string;
  module: string;
  permission: string;
  schema: { parse(i: unknown): any };
  sequence?: string;
  label: (r: any) => string;
  toData: (input: any) => Record<string, unknown>;
  afterCreate?: (tx: Tx, ctx: Ctx, rec: any) => Promise<void>;
  validate?: (tx: Tx, input: any, id?: string) => Promise<void>;
  statusField?: { field: string; active: unknown; inactive: unknown };
};

const nullify = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, val]) => [k, n(val)]));

export const ENTITIES = {
  customer: {
    model: "customer",
    module: "customers",
    permission: "customers.manage",
    schema: v.customerSchema,
    sequence: "CUSTOMER",
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify({ ...i, stateCode: i.stateCode || (i.gstin ? i.gstin.slice(0, 2) : undefined) }),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  customerContact: {
    model: "customerContact",
    module: "customers",
    permission: "customers.manage",
    schema: v.customerContactSchema,
    label: (r) => r.name,
    toData: (i) => nullify(i),
  },
  site: {
    model: "customerSite",
    module: "customers",
    permission: "customers.manage",
    schema: v.siteSchema,
    sequence: "SITE",
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify(i),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  wasteCategory: {
    model: "wasteCategory",
    module: "masters",
    permission: "masters.manage",
    schema: v.wasteCategorySchema,
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify(i),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  wasteType: {
    model: "wasteType",
    module: "masters",
    permission: "masters.manage",
    schema: v.wasteTypeSchema,
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify(i),
    statusField: { field: "active", active: true, inactive: false },
    // Every waste type gets a RAW stock item so received (weighed) waste can be tracked in inventory.
    afterCreate: async (tx, _ctx, rec) => {
      await tx.inventoryItem.upsert({
        where: { code: `RAW-${rec.code}` },
        update: {},
        create: { code: `RAW-${rec.code}`, name: `${rec.name} (Unprocessed)`, itemType: "RAW", wasteTypeId: rec.id, unit: rec.unit },
      });
    },
  },
  vehicle: {
    model: "vehicle",
    module: "vehicles",
    permission: "vehicles.manage",
    schema: v.vehicleSchema,
    label: (r) => r.number,
    toData: (i) =>
      nullify({
        ...i,
        rcExpiry: d(i.rcExpiry),
        insuranceExpiry: d(i.insuranceExpiry),
        fcExpiry: d(i.fcExpiry),
        pollutionExpiry: d(i.pollutionExpiry),
        permitExpiry: d(i.permitExpiry),
      }),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  driver: {
    model: "driver",
    module: "drivers",
    permission: "drivers.manage",
    schema: v.driverSchema,
    sequence: "DRIVER",
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify({ ...i, licenceExpiry: d(i.licenceExpiry), joiningDate: d(i.joiningDate) }),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  buyer: {
    model: "buyer",
    module: "sales",
    permission: "sales.manage",
    schema: v.buyerSchema,
    sequence: "BUYER",
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify({ ...i, stateCode: i.stateCode || (i.gstin ? i.gstin.slice(0, 2) : undefined) }),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  supplier: {
    model: "supplier",
    module: "purchases",
    permission: "purchases.manage",
    schema: v.supplierSchema,
    sequence: "SUPPLIER",
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify({ ...i, stateCode: i.stateCode || (i.gstin ? i.gstin.slice(0, 2) : undefined) }),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  location: {
    model: "location",
    module: "masters",
    permission: "masters.manage",
    schema: v.locationSchema,
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify(i),
    statusField: { field: "status", active: "ACTIVE", inactive: "INACTIVE" },
  },
  expenseCategory: {
    model: "expenseCategory",
    module: "masters",
    permission: "masters.manage",
    schema: v.expenseCategorySchema,
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify(i),
    statusField: { field: "active", active: true, inactive: false },
  },
  gstRate: {
    model: "gstRate",
    module: "gst",
    permission: "gst.manage",
    schema: v.gstRateSchema,
    label: (r) => `${r.name} (${r.rate}%)`,
    toData: (i) => nullify(i),
    statusField: { field: "active", active: true, inactive: false },
  },
  inventoryItem: {
    model: "inventoryItem",
    module: "inventory",
    permission: "masters.manage",
    schema: v.inventoryItemSchema,
    label: (r) => `${r.code} - ${r.name}`,
    toData: (i) => nullify(i),
    statusField: { field: "active", active: true, inactive: false },
    validate: async (_tx, i) => {
      if (i.allowNegative && i.itemType !== "OTHER") {
        // Allowed, but it is an explicit admin decision; nothing else to validate.
      }
    },
  },
} satisfies Record<string, EntityDef>;

export type EntityKey = keyof typeof ENTITIES;

function def(key: string): EntityDef {
  const e = (ENTITIES as Record<string, EntityDef>)[key];
  if (!e) throw new AppError("Unknown record type.");
  return e;
}

export async function createEntity(ctx: Ctx, key: EntityKey, input: unknown) {
  const e = def(key);
  assertCan(ctx, e.permission);
  const data = e.toData(e.schema.parse(input));
  return prisma.$transaction(async (tx) => {
    await e.validate?.(tx, data);
    if (e.sequence) data.code = await nextNumber(tx, e.sequence);
    const rec = await (tx as any)[e.model].create({ data });
    await e.afterCreate?.(tx, ctx, rec);
    await audit(tx, ctx, { action: "CREATE", module: e.module, recordId: rec.id, recordLabel: e.label(rec), newValues: rec });
    return rec as { id: string };
  });
}

export async function updateEntity(ctx: Ctx, key: EntityKey, id: string, input: unknown) {
  const e = def(key);
  assertCan(ctx, e.permission);
  const data = e.toData(e.schema.parse(input));
  return prisma.$transaction(async (tx) => {
    const before = await (tx as any)[e.model].findUnique({ where: { id } });
    if (!before) throw new AppError("Record not found.");
    await e.validate?.(tx, data, id);
    const rec = await (tx as any)[e.model].update({ where: { id }, data });
    const changes = diff(before, rec);
    if (Object.keys(changes.after).length) {
      await audit(tx, ctx, {
        action: "UPDATE",
        module: e.module,
        recordId: id,
        recordLabel: e.label(rec),
        oldValues: changes.before,
        newValues: changes.after,
      });
    }
    return rec as { id: string };
  });
}

/** Activate / deactivate instead of deleting master records. */
export async function setEntityActive(ctx: Ctx, key: EntityKey, id: string, active: boolean) {
  const e = def(key);
  assertCan(ctx, e.permission);
  if (!e.statusField) throw new AppError("This record cannot be activated/deactivated.");
  const { field, active: on, inactive: off } = e.statusField;
  return prisma.$transaction(async (tx) => {
    const before = await (tx as any)[e.model].findUnique({ where: { id } });
    if (!before) throw new AppError("Record not found.");
    const rec = await (tx as any)[e.model].update({ where: { id }, data: { [field]: active ? on : off } });
    await audit(tx, ctx, {
      action: active ? "ACTIVATE" : "DEACTIVATE",
      module: e.module,
      recordId: id,
      recordLabel: e.label(rec),
      oldValues: { [field]: before[field] },
      newValues: { [field]: rec[field] },
    });
    return rec;
  });
}
