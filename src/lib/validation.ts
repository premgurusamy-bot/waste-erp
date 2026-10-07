import { z } from "zod";

// ---------- primitives (form inputs arrive as strings) ----------
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);

export const optText = (max = 500) => z.preprocess(blank, z.string().trim().max(max, `Maximum ${max} characters`).optional());
export const reqText = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `Maximum ${max} characters`);
export const reqId = (label: string) =>
  z.string({ required_error: `Select ${label}`, invalid_type_error: `Select ${label}` }).min(1, `Select ${label}`);
export const optId = z.preprocess(blank, z.string().optional());
export const optNum = (label = "Value") =>
  z.preprocess(blank, z.coerce.number({ invalid_type_error: `${label} must be a number` }).optional());
export const reqNum = (label: string) =>
  z.preprocess(
    blank,
    z.coerce.number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` }),
  );
export const posNum = (label: string) => reqNum(label).pipe(z.number().positive(`${label} must be greater than zero`));
export const nonNegNum = (label: string) => reqNum(label).pipe(z.number().min(0, `${label} cannot be negative`));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const reqDate = (label: string) =>
  z.string({ required_error: `${label} is required` }).regex(ISO_DATE, `${label} is required`);
export const optDate = z.preprocess(blank, z.string().regex(ISO_DATE, "Invalid date").optional());
export const reqDateTime = (label: string) =>
  z.string({ required_error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${label} is required`);
export const optTime = z.preprocess(blank, z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").optional());
export const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === 1, z.boolean());
export const gstin = z.preprocess(
  (v) => blank(upper(v)),
  z
    .string()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5)")
    .optional(),
);
export const mobile = z.preprocess(
  (v) => (typeof v === "string" ? blank(v.replace(/[\s-]/g, "")) : blank(v)),
  z
    .string()
    .regex(/^(\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")
    .optional(),
);
export const email = z.preprocess(blank, z.string().trim().email("Enter a valid email address").optional());
export const statusEnum = z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE");
export const reason = (label = "Reason") => reqText(label, 500).pipe(z.string().min(3, `${label} must be at least 3 characters`));

// ---------- masters ----------
export const customerSchema = z.object({
  name: reqText("Customer name"),
  gstin,
  stateCode: optText(2),
  contactPerson: optText(100),
  mobile,
  email,
  address: optText(500),
  city: optText(100),
  pincode: z.preprocess(blank, z.string().regex(/^\d{6}$/, "PIN code must be 6 digits").optional()),
  status: statusEnum,
  creditDays: z.preprocess(blank, z.coerce.number().int().min(0, "Cannot be negative").max(365).default(30)),
  remarks: optText(1000),
});

export const customerContactSchema = z.object({
  customerId: reqId("customer"),
  name: reqText("Contact name", 100),
  designation: optText(100),
  mobile,
  email,
  isPrimary: bool.default(false),
});

export const FREQUENCIES = ["DAILY", "ALTERNATE_DAYS", "TWICE_WEEKLY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "ON_CALL"] as const;
export const siteSchema = z.object({
  customerId: reqId("customer"),
  name: reqText("Site name"),
  address: optText(500),
  contactName: optText(100),
  contactMobile: mobile,
  latitude: optNum("Latitude").pipe(z.number().min(-90).max(90).optional()),
  longitude: optNum("Longitude").pipe(z.number().min(-180).max(180).optional()),
  defaultWasteTypeId: optId,
  frequency: z.enum(FREQUENCIES).default("DAILY"),
  collectionTime: optTime,
  status: statusEnum,
  remarks: optText(1000),
});

export const wasteCategorySchema = z.object({
  code: z.preprocess(upper, reqText("Code", 20)),
  name: reqText("Name", 100),
  description: optText(500),
  status: statusEnum,
});

export const wasteTypeSchema = z.object({
  code: z.preprocess(upper, reqText("Code", 20)),
  name: reqText("Name", 100),
  categoryId: reqId("category"),
  unit: reqText("Unit", 10).default("KG"),
  isRecyclable: bool.default(false),
  hsnSac: optText(10),
  description: optText(500),
  active: bool.default(true),
});

export const VEHICLE_TYPES = ["Compactor", "Tipper", "Mini Truck", "Tractor", "Hook Loader", "Skip Loader", "Pickup Van", "Other"] as const;
export const vehicleSchema = z.object({
  number: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, " ") : v),
    reqText("Vehicle number", 20).pipe(z.string().regex(/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/, "Enter a valid vehicle number (e.g. TN 37 AB 1234)")),
  ),
  type: reqText("Vehicle type", 50),
  capacityKg: posNum("Capacity"),
  fuelType: reqText("Fuel type", 20).default("DIESEL"),
  ownership: z.enum(["OWNED", "HIRED"]).default("OWNED"),
  ownerName: optText(100),
  rcNumber: optText(30),
  rcExpiry: optDate,
  insuranceExpiry: optDate,
  fcExpiry: optDate,
  pollutionExpiry: optDate,
  permitExpiry: optDate,
  standardTareKg: optNum("Standard tare").pipe(z.number().min(0).optional()),
  defaultDriverId: optId,
  status: z.enum(["ACTIVE", "UNDER_MAINTENANCE", "INACTIVE"]).default("ACTIVE"),
  remarks: optText(1000),
});

export const driverSchema = z.object({
  name: reqText("Driver name", 100),
  mobile,
  licenceNumber: z.preprocess(upper, reqText("Licence number", 30)),
  licenceExpiry: optDate,
  address: optText(500),
  joiningDate: optDate,
  status: statusEnum,
  remarks: optText(1000),
});

const partyBase = {
  name: reqText("Name"),
  gstin,
  stateCode: optText(2),
  contactPerson: optText(100),
  mobile,
  email,
  address: optText(500),
  paymentTermsDays: z.preprocess(blank, z.coerce.number().int().min(0).max(365).default(15)),
  status: statusEnum,
  remarks: optText(1000),
};
export const buyerSchema = z.object(partyBase);
export const supplierSchema = z.object(partyBase);

export const locationSchema = z.object({
  branchId: reqId("branch"),
  code: z.preprocess(upper, reqText("Code", 20)),
  name: reqText("Name", 100),
  type: z.enum(["YARD", "STORE", "PROCESSING"]).default("YARD"),
  status: statusEnum,
});

export const expenseCategorySchema = z.object({
  code: z.preprocess(upper, reqText("Code", 20)),
  name: reqText("Name", 100),
  accountId: optId,
  active: bool.default(true),
});

export const gstRateSchema = z.object({
  name: reqText("Name", 50),
  rate: nonNegNum("Rate").pipe(z.number().max(100, "Rate cannot exceed 100%")),
  description: optText(200),
  active: bool.default(true),
});

export const inventoryItemSchema = z.object({
  code: z.preprocess(upper, reqText("Code", 20)),
  name: reqText("Name", 100),
  itemType: z.enum(["RAW", "RECOVERED", "REJECT", "OTHER"]),
  wasteTypeId: optId,
  unit: reqText("Unit", 10).default("KG"),
  hsnCode: optText(10),
  gstRateId: optId,
  reorderLevel: optNum("Reorder level").pipe(z.number().min(0).optional()),
  defaultSaleRate: optNum("Sale rate").pipe(z.number().min(0).optional()),
  isSaleable: bool.default(false),
  allowNegative: bool.default(false),
  active: bool.default(true),
});

// ---------- contracts ----------
export const contractSchema = z
  .object({
    customerId: reqId("customer"),
    title: reqText("Contract title"),
    startDate: reqDate("Start date"),
    endDate: optDate,
    paymentTermsDays: z.preprocess(blank, z.coerce.number().int().min(0).max(365).default(30)),
    status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).default("ACTIVE"),
    remarks: optText(1000),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "End date must be after start date" });

export const BILLING_UNITS = { WEIGHT: ["KG", "TONNE"], TRIP: ["TRIP"], MONTHLY: ["MONTH"] } as const;
export const rateSchema = z
  .object({
    contractId: reqId("contract"),
    siteId: optId,
    wasteTypeId: optId,
    billingMethod: z.enum(["WEIGHT", "TRIP", "MONTHLY"], { required_error: "Select billing method" }),
    description: optText(200),
    rate: nonNegNum("Rate"),
    unit: z.enum(["KG", "TONNE", "TRIP", "MONTH"], { required_error: "Select unit" }),
    taxTreatment: z.enum(["TAXABLE", "EXEMPT"]).default("TAXABLE"),
    gstRateId: optId,
    sacCode: optText(10),
    effectiveFrom: reqDate("Effective from"),
  })
  .refine((v) => (BILLING_UNITS[v.billingMethod] as readonly string[]).includes(v.unit), {
    path: ["unit"],
    message: "Unit does not match billing method (Weight: KG/TONNE, Trip: TRIP, Monthly: MONTH)",
  });

export const rateRevisionSchema = z.object({
  rateId: reqId("rate"),
  rate: nonNegNum("New rate"),
  effectiveFrom: reqDate("Effective from"),
  gstRateId: optId,
  description: optText(200),
});

// ---------- operations ----------
export const pickupSchema = z.object({
  customerId: reqId("customer"),
  siteId: reqId("site"),
  wasteTypeId: reqId("waste type"),
  requestedDate: reqDate("Requested date"),
  requestedTime: optTime,
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  estimatedQty: optNum("Estimated quantity").pipe(z.number().min(0).optional()),
  remarks: optText(1000),
});

export const scheduleSchema = z.object({
  pickupRequestId: optId,
  customerId: reqId("customer"),
  siteId: reqId("site"),
  wasteTypeId: reqId("waste type"),
  scheduledDate: reqDate("Scheduled date"),
  scheduledTime: optTime,
  vehicleId: optId,
  driverId: optId,
  remarks: optText(1000),
});

export const assignSchema = z.object({
  scheduleId: reqId("schedule"),
  vehicleId: reqId("vehicle"),
  driverId: reqId("driver"),
});

export const rescheduleSchema = z.object({
  scheduleId: reqId("schedule"),
  scheduledDate: reqDate("New date"),
  scheduledTime: optTime,
  remarks: optText(500),
});

export const collectionSchema = z.object({
  scheduleId: optId,
  customerId: reqId("customer"),
  siteId: reqId("site"),
  vehicleId: reqId("vehicle"),
  driverId: optId,
  wasteTypeId: reqId("waste type"),
  collectionDate: reqDateTime("Collection date/time"),
  estimatedQty: optNum("Estimated quantity").pipe(z.number().min(0, "Cannot be negative").optional()),
  actualQty: optNum("Actual quantity").pipe(z.number().min(0, "Cannot be negative").optional()),
  status: z.enum(["COMPLETED", "PARTIAL", "NOT_COLLECTED"]).default("COMPLETED"),
  remarks: optText(1000),
  photoDocumentId: optId,
  latitude: optNum().pipe(z.number().min(-90).max(90).optional()),
  longitude: optNum().pipe(z.number().min(-180).max(180).optional()),
});

export const gateInSchema = z.object({
  collectionEntryId: optId,
  vehicleId: reqId("vehicle"),
  driverId: optId,
  customerId: reqId("customer"),
  siteId: optId,
  wasteTypeId: reqId("waste type"),
  locationId: reqId("receiving location"),
  gateInAt: reqDateTime("Gate-in date/time"),
  grossWeight: posNum("Gross weight").pipe(z.number().max(100000, "Gross weight looks too high (max 100,000 KG)")),
  slipNumber: optText(30),
  remarks: optText(500),
});

export const gateOutSchema = z.object({
  weighmentId: reqId("weighment"),
  tareWeight: nonNegNum("Tare weight"),
  gateOutAt: reqDateTime("Gate-out date/time"),
  remarks: optText(500),
});

export const netOverrideSchema = z.object({
  weighmentId: reqId("weighment"),
  netWeight: nonNegNum("Net weight"),
  reason: reason("Override reason"),
});

const lineQty = z.object({ itemId: reqId("material"), quantity: posNum("Quantity") });
export const processingSchema = z.object({
  batchNo: reqText("Batch number", 40),
  date: reqDate("Date"),
  locationId: reqId("processing location"),
  inputs: z.array(lineQty).min(1, "Add at least one input"),
  outputs: z.array(lineQty).default([]),
  rejectedQty: nonNegNum("Rejected quantity").default(0),
  lossQty: nonNegNum("Process loss").default(0),
  remarks: optText(1000),
});

export const stockMovementSchema = z
  .object({
    kind: z.enum(["OPENING", "TRANSFER", "ADJUSTMENT", "DISPOSAL"]),
    date: reqDate("Date"),
    itemId: reqId("material"),
    locationId: reqId("location"),
    toLocationId: optId,
    quantity: reqNum("Quantity").pipe(z.number().refine((n) => n !== 0, "Quantity cannot be zero")),
    allowNegative: bool.default(false),
    remarks: optText(500),
  })
  .refine((v) => v.kind !== "TRANSFER" || (v.toLocationId && v.toLocationId !== v.locationId), {
    path: ["toLocationId"],
    message: "Select a different destination location",
  })
  .refine((v) => v.kind === "ADJUSTMENT" || v.quantity > 0, { path: ["quantity"], message: "Quantity must be positive" })
  .refine((v) => v.kind !== "ADJUSTMENT" || !!v.remarks, { path: ["remarks"], message: "Reason is required for adjustments" });

// ---------- commercial ----------
export const saleLine = z.object({
  itemId: reqId("material"),
  quantity: posNum("Quantity"),
  rate: nonNegNum("Rate"),
  gstRate: optNum("GST %").pipe(z.number().min(0).max(100).optional()),
});
export const salesInvoiceSchema = z.object({
  date: reqDate("Date"),
  buyerId: reqId("buyer"),
  locationId: reqId("stock location"),
  vehicleNumber: optText(20),
  remarks: optText(1000),
  items: z.array(saleLine).min(1, "Add at least one material"),
});

export const manualInvoiceLine = z.object({
  description: reqText("Description", 300),
  quantity: posNum("Quantity"),
  unit: reqText("Unit", 10),
  rate: nonNegNum("Rate"),
  gstRate: optNum("GST %").pipe(z.number().min(0).max(100).optional()),
  sacCode: optText(10),
});
export const customerInvoiceSchema = z
  .object({
    customerId: reqId("customer"),
    siteId: optId,
    date: reqDate("Invoice date"),
    periodFrom: reqDate("Billing period from"),
    periodTo: reqDate("Billing period to"),
    includeAuto: bool.default(true),
    manualLines: z.array(manualInvoiceLine).default([]),
    notes: optText(1000),
  })
  .refine((v) => v.periodTo >= v.periodFrom, { path: ["periodTo"], message: "Period end must be after start" });

const allocation = z.object({ invoiceId: reqId("invoice"), amount: posNum("Amount") });
export const PAYMENT_MODES = ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"] as const;
export const receiptSchema = z
  .object({
    date: reqDate("Date"),
    partyType: z.enum(["CUSTOMER", "BUYER"]),
    customerId: optId,
    buyerId: optId,
    amount: posNum("Amount"),
    mode: z.enum(PAYMENT_MODES),
    accountId: reqId("cash/bank account"),
    reference: optText(60),
    remarks: optText(500),
    allocations: z.array(allocation).default([]),
  })
  .refine((v) => (v.partyType === "CUSTOMER" ? !!v.customerId : !!v.buyerId), { path: ["customerId"], message: "Select the party" });

export const receiptAllocateSchema = z.object({ receiptId: reqId("receipt"), allocations: z.array(allocation).min(1) });

export const paymentSchema = z.object({
  date: reqDate("Date"),
  supplierId: reqId("supplier"),
  amount: posNum("Amount"),
  mode: z.enum(PAYMENT_MODES),
  accountId: reqId("cash/bank account"),
  reference: optText(60),
  remarks: optText(500),
  allocations: z
    .array(z.object({ docType: z.enum(["PURCHASE", "EXPENSE"]), docId: reqId("bill"), amount: posNum("Amount") }))
    .default([]),
});

export const purchaseLine = z.object({
  itemId: optId,
  description: reqText("Description", 300),
  quantity: posNum("Quantity"),
  unit: reqText("Unit", 10),
  rate: nonNegNum("Rate"),
  gstRate: optNum("GST %").pipe(z.number().min(0).max(100).optional()),
  hsnCode: optText(10),
});
export const purchaseSchema = z.object({
  date: reqDate("Date"),
  supplierId: reqId("supplier"),
  billNumber: optText(40),
  billDate: optDate,
  locationId: optId,
  remarks: optText(1000),
  items: z.array(purchaseLine).min(1, "Add at least one line"),
});

export const expenseSchema = z
  .object({
    date: reqDate("Date"),
    categoryId: reqId("category"),
    supplierId: optId,
    vehicleId: optId,
    description: optText(300),
    amount: posNum("Amount"),
    gstRate: optNum("GST %").pipe(z.number().min(0).max(100).optional()),
    paymentMode: z.enum([...PAYMENT_MODES, "CREDIT"]),
    accountId: optId,
    reference: optText(60),
    remarks: optText(1000),
  })
  .refine((v) => v.paymentMode !== "CREDIT" || !!v.supplierId, { path: ["supplierId"], message: "Supplier is required for credit expenses" })
  .refine((v) => v.paymentMode === "CREDIT" || !!v.accountId, { path: ["accountId"], message: "Select the cash/bank account used" });

export const fuelSchema = z.object({
  vehicleId: reqId("vehicle"),
  driverId: optId,
  date: reqDate("Date"),
  litres: posNum("Litres"),
  ratePerLitre: posNum("Rate per litre"),
  odometer: optNum("Odometer").pipe(z.number().int().min(0).optional()),
  fuelStation: optText(100),
  paymentMode: z.enum([...PAYMENT_MODES, "CREDIT"]).default("CASH"),
  accountId: optId,
  supplierId: optId,
});

export const maintenanceSchema = z.object({
  vehicleId: reqId("vehicle"),
  date: reqDate("Date"),
  maintenanceType: z.enum(["SERVICE", "REPAIR", "TYRE", "BATTERY", "BODY_WORK", "OTHER"]),
  description: reqText("Description", 300),
  supplierId: optId,
  amount: posNum("Amount"),
  odometer: optNum("Odometer").pipe(z.number().int().min(0).optional()),
  nextServiceDate: optDate,
  paymentMode: z.enum([...PAYMENT_MODES, "CREDIT"]).default("CASH"),
  accountId: optId,
});

export const journalSchema = z.object({
  date: reqDate("Date"),
  narration: reqText("Narration", 300),
  lines: z
    .array(z.object({ accountId: reqId("account"), debit: nonNegNum("Debit").default(0), credit: nonNegNum("Credit").default(0) }))
    .min(2, "A journal needs at least two lines"),
});

export const ledgerAccountSchema = z.object({
  code: reqText("Code", 10),
  name: reqText("Name", 100),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  subType: optText(30),
  openingBalance: optNum("Opening balance").default(0),
  active: bool.default(true),
});

// ---------- administration ----------
export const passwordRule = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

export const userCreateSchema = z.object({
  username: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    reqText("Username", 40).pipe(z.string().regex(/^[a-z0-9._-]{3,40}$/, "3-40 letters, numbers, dot, dash or underscore")),
  ),
  name: reqText("Full name", 100),
  email,
  mobile,
  password: passwordRule,
  roleIds: z.array(z.string()).min(1, "Assign at least one role"),
  permissionCodes: z.array(z.string()).default([]),
});

export const userUpdateSchema = z.object({
  id: reqId("user"),
  name: reqText("Full name", 100),
  email,
  mobile,
  status: z.enum(["ACTIVE", "DISABLED"]),
  roleIds: z.array(z.string()).min(1, "Assign at least one role"),
  permissionCodes: z.array(z.string()).default([]),
});

export const changePasswordSchema = z
  .object({
    currentPassword: reqText("Current password", 200),
    newPassword: passwordRule,
    confirmPassword: reqText("Confirm password", 200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const companySchema = z.object({
  name: reqText("Company name"),
  legalName: optText(200),
  gstin,
  pan: optText(10),
  stateCode: reqText("State", 2),
  address: optText(500),
  city: optText(100),
  pincode: optText(6),
  phone: optText(20),
  email,
  website: optText(100),
  bankName: optText(100),
  bankAccountNo: optText(30),
  bankIfsc: optText(15),
  invoiceFooter: optText(500),
});

export const gstSettingsSchema = z.object({
  gstEnabled: bool,
  defaultServiceSac: reqText("Default SAC", 10),
  defaultServiceRateId: optId,
  defaultGoodsRateId: optId,
  roundOffInvoices: bool,
});

export const sequenceSchema = z.object({
  key: reqId("sequence"),
  prefix: reqText("Prefix", 15).pipe(z.string().regex(/^[A-Za-z0-9/_-]+$/, "Letters, numbers, / - _ only")),
  includeYear: bool,
  padding: z.preprocess(blank, z.coerce.number().int().min(3).max(8)),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type SiteInput = z.infer<typeof siteSchema>;
