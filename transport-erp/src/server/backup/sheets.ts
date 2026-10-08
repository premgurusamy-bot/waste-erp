/**
 * The Excel backup layout. ONE registry drives export, checksum, validation and restore,
 * so the four can never disagree about a column.
 *
 * - `key`      database field (Prisma)
 * - `header`   human readable column title written to Excel (and matched on restore)
 * - `derived`  calculated for people reading the file (grey columns). Ignored on restore.
 * - `ref`      the sheet whose ID this column must point to (relationship check on restore)
 */
import { EXPENSE_CATEGORIES, TRIP_STATUSES, tripProfit, round2, num } from "../../shared/calc.js";

export type ColType = "id" | "string" | "int" | "money" | "qty" | "km" | "pct" | "date" | "datetime" | "bool" | "json";

export type Col = {
  key: string;
  header: string;
  type: ColType;
  required?: boolean;
  ref?: SheetKey;
  enum?: readonly string[];
  derived?: boolean;
  width?: number;
  total?: boolean;
};

export type SheetKey =
  | "company" | "customers" | "transporters" | "vehicles" | "drivers" | "loadingPoints" | "deliveryPoints"
  | "trips" | "tripItems" | "freight" | "expenses" | "invoices" | "invoiceItems" | "receipts" | "settlements"
  | "payments" | "documents" | "vehicleDocuments" | "driverDocuments" | "targets" | "notifications" | "auditLogs" | "settings";

export type Lookups = Record<string, Map<string, any>>;

export type SheetDef = {
  key: SheetKey;
  name: string;
  label: string;
  model: string; // prisma delegate
  idKey: string; // primary key field
  codeKey?: string; // human readable code for messages
  uniques?: string[]; // single-column unique keys besides the id
  columns: Col[];
  derive?: (row: any, l: Lookups) => Record<string, unknown>;
};

const ACTIVE = ["ACTIVE", "INACTIVE"] as const;
const id = (header: string): Col => ({ key: "id", header, type: "id", required: true, width: 38 });
const s = (key: string, header: string, extra: Partial<Col> = {}): Col => ({ key, header, type: "string", ...extra });
const m = (key: string, header: string, extra: Partial<Col> = {}): Col => ({ key, header, type: "money", width: 14, ...extra });
const d = (key: string, header: string, extra: Partial<Col> = {}): Col => ({ key, header, type: "date", width: 12, ...extra });
const r = (key: string, header: string, ref: SheetKey, required = false): Col => ({ key, header, type: "id", ref, required, width: 38 });
const created: Col[] = [
  { key: "createdAt", header: "Created At", type: "datetime", width: 26 },
  { key: "updatedAt", header: "Updated At", type: "datetime", width: 26 },
];
const name = (l: Lookups, sheet: string, idv: string | null, field = "name") => (idv ? l[sheet]?.get(idv)?.[field] ?? "" : "");

export const SHEETS: SheetDef[] = [
  {
    key: "company", name: "01_Company", label: "Company", model: "company", idKey: "id",
    columns: [
      id("Company ID"), s("name", "Company Name", { required: true, width: 30 }), s("legalName", "Legal Name"), s("gstin", "GSTIN"), s("pan", "PAN"),
      s("address", "Address", { width: 40 }), s("city", "City"), s("state", "State"), s("stateCode", "State Code"), s("pincode", "Pincode"),
      s("phone", "Phone"), s("email", "Email"), s("bankName", "Bank Name"), s("bankAccount", "Bank Account"), s("bankIfsc", "Bank IFSC"),
      s("invoicePrefix", "Invoice Prefix", { required: true }), ...created,
    ],
  },
  {
    key: "customers", name: "02_Customers", label: "Customers", model: "customer", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Customer ID"), s("code", "Customer Code", { required: true }), s("name", "Customer Name", { required: true, width: 30 }), s("company", "Company", { width: 24 }),
      s("gstin", "GSTIN"), s("pan", "PAN"), s("contactPerson", "Contact Person"), s("mobile", "Mobile"), s("email", "Email"),
      s("address", "Address", { width: 40 }), s("city", "City"), s("state", "State"), s("paymentTerms", "Payment Terms"),
      { key: "creditDays", header: "Credit Days", type: "int" }, m("openingBalance", "Opening Balance", { total: true }),
      s("status", "Status", { required: true, enum: ACTIVE }), s("notes", "Notes", { width: 30 }), ...created,
    ],
  },
  {
    key: "transporters", name: "03_Transporters", label: "Transporters", model: "transporter", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Transporter ID"), s("code", "Transporter Code", { required: true }), s("name", "Transporter Name", { required: true, width: 30 }),
      s("contactPerson", "Contact Person"), s("mobile", "Mobile"), s("gstin", "GSTIN"), s("pan", "PAN"), s("address", "Address", { width: 40 }), s("city", "City"),
      s("bankName", "Bank Name"), s("bankAccount", "Bank Account"), s("bankIfsc", "Bank IFSC"), s("bankBranch", "Bank Branch"), s("upiId", "UPI ID"),
      s("paymentTerms", "Payment Terms"), m("openingBalance", "Opening Balance", { total: true }), s("status", "Status", { required: true, enum: ACTIVE }),
      s("notes", "Notes", { width: 30 }), ...created,
    ],
  },
  {
    key: "vehicles", name: "04_Vehicles", label: "Vehicles", model: "vehicle", idKey: "id", codeKey: "vehicleNumber", uniques: ["code", "vehicleNumber"],
    columns: [
      id("Vehicle ID"), s("code", "Vehicle Code", { required: true }), s("vehicleNumber", "Vehicle Number", { required: true, width: 16 }), s("vehicleType", "Vehicle Type"),
      { key: "capacityTons", header: "Capacity (Tons)", type: "qty" }, s("ownerName", "Owner"), s("ownership", "Ownership", { required: true, enum: ["OWN", "MARKET", "ATTACHED"] }),
      r("transporterId", "Transporter ID", "transporters"), s("transporterName", "Transporter Name", { derived: true, width: 24 }),
      d("rcExpiry", "RC Expiry"), d("insuranceExpiry", "Insurance Expiry"), d("fcExpiry", "FC Expiry"), d("permitExpiry", "Permit Expiry"),
      d("pollutionExpiry", "Pollution Expiry"), d("roadTaxExpiry", "Road Tax Expiry"), s("status", "Status", { required: true, enum: ACTIVE }), s("notes", "Notes"), ...created,
    ],
    derive: (row, l) => ({ transporterName: name(l, "transporters", row.transporterId) }),
  },
  {
    key: "drivers", name: "05_Drivers", label: "Drivers", model: "driver", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Driver ID"), s("code", "Driver Code", { required: true }), s("name", "Driver Name", { required: true, width: 24 }), s("mobile", "Mobile"),
      s("licenseNumber", "License Number", { width: 20 }), d("licenseExpiry", "License Expiry"), s("address", "Address", { width: 40 }),
      m("rate", "Rate"), s("rateType", "Rate Type", { enum: ["PER_TRIP", "PER_DAY", "PER_MONTH"] }), r("transporterId", "Transporter ID", "transporters"),
      s("transporterName", "Transporter Name", { derived: true, width: 24 }), s("status", "Status", { required: true, enum: ACTIVE }), s("notes", "Notes"), ...created,
    ],
    derive: (row, l) => ({ transporterName: name(l, "transporters", row.transporterId) }),
  },
  {
    key: "loadingPoints", name: "06_LoadingPoints", label: "Loading Points", model: "loadingPoint", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Loading Point ID"), s("code", "Code", { required: true }), s("name", "Loading Point", { required: true, width: 24 }), s("address", "Address", { width: 40 }),
      s("city", "City"), s("state", "State"), s("pincode", "Pincode"), s("contactPerson", "Contact Person"), s("mobile", "Mobile"),
      s("status", "Status", { required: true, enum: ACTIVE }), ...created,
    ],
  },
  {
    key: "deliveryPoints", name: "07_DeliveryPoints", label: "Delivery Points", model: "deliveryPoint", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Delivery Point ID"), s("code", "Code", { required: true }), s("name", "Delivery Point", { required: true, width: 24 }), s("address", "Address", { width: 40 }),
      s("city", "City"), s("state", "State"), s("pincode", "Pincode"), s("contactPerson", "Contact Person"), s("mobile", "Mobile"),
      s("status", "Status", { required: true, enum: ACTIVE }), ...created,
    ],
  },
  {
    key: "trips", name: "08_Trips", label: "Trips", model: "trip", idKey: "id", codeKey: "tripNumber", uniques: ["tripNumber"],
    columns: [
      id("Trip ID"), s("tripNumber", "Trip Number", { required: true, width: 13 }), d("tripDate", "Trip Date", { required: true }),
      r("customerId", "Customer ID", "customers", true), s("customerName", "Customer", { derived: true, width: 24 }),
      r("transporterId", "Transporter ID", "transporters"), s("transporterName", "Transporter", { derived: true, width: 22 }),
      r("vehicleId", "Vehicle ID", "vehicles"), s("vehicleNumber", "Vehicle", { derived: true, width: 14 }),
      r("driverId", "Driver ID", "drivers"), s("driverName", "Driver", { derived: true, width: 18 }),
      r("loadingPointId", "Loading Point ID", "loadingPoints"), s("loadingPointName", "Loading Point", { derived: true, width: 18 }),
      r("deliveryPointId", "Delivery Point ID", "deliveryPoints"), s("deliveryPointName", "Delivery Point", { derived: true, width: 18 }),
      s("material", "Material"), { key: "quantity", header: "Quantity", type: "qty" }, s("unit", "Unit"),
      { key: "weightTons", header: "Weight (Tons)", type: "qty", total: true }, { key: "distanceKm", header: "Distance KM", type: "km", total: true },
      s("lrNumber", "LR Number"), d("lrDate", "LR Date"), s("ewayBillNumber", "E-Way Bill Number", { width: 16 }), d("ewayBillExpiry", "E-Way Bill Expiry"),
      m("customerFreight", "Customer Freight", { total: true }), m("transporterHire", "Transporter Hire", { total: true }),
      m("loadingCharges", "Loading", { total: true }), m("unloadingCharges", "Unloading", { total: true }), m("diesel", "Diesel", { total: true }),
      m("toll", "Toll", { total: true }), m("rto", "RTO", { total: true }), m("driverBata", "Driver Bata", { total: true }),
      m("otherExpense", "Other Expense", { total: true }), m("advance", "Advance", { total: true }),
      m("hireBalance", "Balance (Hire - Advance)", { derived: true, total: true }), m("tripCost", "Total Cost", { derived: true, total: true }),
      m("tripProfit", "Profit / Loss", { derived: true, total: true }),
      s("status", "Status", { required: true, enum: TRIP_STATUSES }), d("deliveredDate", "Delivered Date"), d("podReceivedDate", "POD Received Date"),
      s("cancelReason", "Cancel Reason"), s("remarks", "Remarks", { width: 30 }), s("createdBy", "Created By"), ...created,
    ],
    derive: (row, l) => {
      const p = tripProfit(row);
      return {
        customerName: name(l, "customers", row.customerId), transporterName: name(l, "transporters", row.transporterId),
        vehicleNumber: name(l, "vehicles", row.vehicleId, "vehicleNumber"), driverName: name(l, "drivers", row.driverId),
        loadingPointName: name(l, "loadingPoints", row.loadingPointId), deliveryPointName: name(l, "deliveryPoints", row.deliveryPointId),
        hireBalance: p.hireBalance, tripCost: p.totalCost, tripProfit: p.profit,
      };
    },
  },
  {
    key: "tripItems", name: "09_TripItems", label: "Trip Items", model: "tripItem", idKey: "id",
    columns: [
      id("Trip Item ID"), r("tripId", "Trip ID", "trips", true), s("tripNumber", "Trip Number", { derived: true }), { key: "lineNo", header: "Line", type: "int", required: true },
      s("description", "Description", { width: 30 }), s("material", "Material"), { key: "packages", header: "Packages", type: "int" },
      { key: "quantity", header: "Quantity", type: "qty" }, s("unit", "Unit"), { key: "weightTons", header: "Weight (Tons)", type: "qty" },
      s("invoiceRef", "Consignor Invoice No."), m("value", "Consignment Value", { total: true }),
    ],
    derive: (row, l) => ({ tripNumber: name(l, "trips", row.tripId, "tripNumber") }),
  },
  {
    key: "freight", name: "10_Freight", label: "Freight Rates", model: "freightRate", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Freight Rate ID"), s("code", "Rate Code", { required: true }), r("customerId", "Customer ID", "customers"), s("customerName", "Customer", { derived: true, width: 24 }),
      r("loadingPointId", "Loading Point ID", "loadingPoints"), s("loadingPointName", "Loading Point", { derived: true }),
      r("deliveryPointId", "Delivery Point ID", "deliveryPoints"), s("deliveryPointName", "Delivery Point", { derived: true }),
      s("vehicleType", "Vehicle Type"), s("rateType", "Rate Type", { required: true, enum: ["PER_TRIP", "PER_TON", "PER_KM"] }),
      m("customerRate", "Customer Rate"), m("transporterRate", "Transporter Rate"), d("effectiveFrom", "Effective From"), d("effectiveTo", "Effective To"),
      s("status", "Status", { required: true, enum: ACTIVE }), s("notes", "Notes"), ...created,
    ],
    derive: (row, l) => ({
      customerName: name(l, "customers", row.customerId), loadingPointName: name(l, "loadingPoints", row.loadingPointId), deliveryPointName: name(l, "deliveryPoints", row.deliveryPointId),
    }),
  },
  {
    key: "expenses", name: "11_Expenses", label: "Expenses", model: "expense", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Expense ID"), s("code", "Expense Code", { required: true }), d("expenseDate", "Expense Date", { required: true }),
      s("category", "Category", { required: true, enum: EXPENSE_CATEGORIES }), m("amount", "Amount", { required: true, total: true }),
      r("tripId", "Trip ID", "trips"), s("tripNumber", "Trip Number", { derived: true }), r("vehicleId", "Vehicle ID", "vehicles"), s("vehicleNumber", "Vehicle", { derived: true }),
      r("driverId", "Driver ID", "drivers"), s("driverName", "Driver", { derived: true }), s("payee", "Paid To"),
      s("paymentMode", "Payment Mode", { required: true }), s("paymentStatus", "Payment Status", { required: true, enum: ["PAID", "UNPAID"] }),
      s("reference", "Reference"), s("description", "Description", { width: 30 }), s("status", "Status", { required: true, enum: ["ACTIVE", "CANCELLED"] }),
      s("createdBy", "Created By"), ...created,
    ],
    derive: (row, l) => ({ tripNumber: name(l, "trips", row.tripId, "tripNumber"), vehicleNumber: name(l, "vehicles", row.vehicleId, "vehicleNumber"), driverName: name(l, "drivers", row.driverId) }),
  },
  {
    key: "invoices", name: "12_CustomerInvoices", label: "Customer Invoices", model: "customerInvoice", idKey: "id", codeKey: "invoiceNumber", uniques: ["invoiceNumber"],
    columns: [
      id("Invoice ID"), s("invoiceNumber", "Invoice Number", { required: true, width: 20 }), d("invoiceDate", "Invoice Date", { required: true }), d("dueDate", "Due Date"),
      r("customerId", "Customer ID", "customers", true), s("customerName", "Customer", { derived: true, width: 24 }),
      m("freightAmount", "Freight", { total: true }), m("otherCharges", "Other Charges", { total: true }), m("taxableValue", "Taxable Value", { total: true }),
      s("gstType", "GST Type", { required: true, enum: ["NONE", "CGST_SGST", "IGST", "RCM"] }), { key: "gstRate", header: "GST Rate %", type: "pct" },
      m("cgst", "CGST", { total: true }), m("sgst", "SGST", { total: true }), m("igst", "IGST", { total: true }), m("roundOff", "Round Off"), m("total", "Invoice Total", { total: true }),
      m("received", "Received", { derived: true, total: true }), m("balance", "Balance", { derived: true, total: true }),
      s("placeOfSupply", "Place of Supply"), s("status", "Status", { required: true, enum: ["ISSUED", "CANCELLED"] }), s("notes", "Notes"), s("createdBy", "Created By"), ...created,
    ],
    derive: (row, l) => {
      const received = l.invoiceReceived?.get(row.id) ?? 0;
      return { customerName: name(l, "customers", row.customerId), received, balance: row.status === "CANCELLED" ? 0 : round2(num(row.total) - received) };
    },
  },
  {
    key: "invoiceItems", name: "13_InvoiceItems", label: "Invoice Items", model: "invoiceItem", idKey: "id",
    columns: [
      id("Invoice Item ID"), r("invoiceId", "Invoice ID", "invoices", true), s("invoiceNumber", "Invoice Number", { derived: true }),
      r("tripId", "Trip ID", "trips"), s("tripNumber", "Trip Number", { derived: true }), { key: "lineNo", header: "Line", type: "int", required: true },
      s("description", "Description", { required: true, width: 40 }), s("sacCode", "SAC Code"), m("amount", "Amount", { required: true, total: true }),
    ],
    derive: (row, l) => ({ invoiceNumber: name(l, "invoices", row.invoiceId, "invoiceNumber"), tripNumber: name(l, "trips", row.tripId, "tripNumber") }),
  },
  {
    key: "receipts", name: "14_CustomerReceipts", label: "Customer Receipts", model: "customerReceipt", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Receipt ID"), s("code", "Receipt Number", { required: true }), d("receiptDate", "Receipt Date", { required: true }),
      r("customerId", "Customer ID", "customers", true), s("customerName", "Customer", { derived: true, width: 24 }),
      r("invoiceId", "Invoice ID", "invoices"), s("invoiceNumber", "Invoice Number", { derived: true }),
      m("amount", "Amount", { required: true, total: true }), m("tdsAmount", "TDS", { total: true }), s("mode", "Mode", { required: true }),
      s("reference", "Reference"), s("notes", "Notes"), s("status", "Status", { required: true, enum: ["ACTIVE", "CANCELLED"] }), s("createdBy", "Created By"), ...created,
    ],
    derive: (row, l) => ({ customerName: name(l, "customers", row.customerId), invoiceNumber: name(l, "invoices", row.invoiceId, "invoiceNumber") }),
  },
  {
    key: "settlements", name: "15_TransporterSettlements", label: "Transporter Settlements", model: "transporterSettlement", idKey: "id", codeKey: "code", uniques: ["code", "tripId"],
    columns: [
      id("Settlement ID"), s("code", "Settlement Number", { required: true }), r("tripId", "Trip ID", "trips", true), s("tripNumber", "Trip Number", { derived: true }),
      r("transporterId", "Transporter ID", "transporters", true), s("transporterName", "Transporter", { derived: true, width: 24 }),
      m("hire", "Hire", { derived: true, total: true }), m("advance", "Advance", { derived: true, total: true }),
      m("deductions", "Deductions", { total: true }), s("deductionNote", "Deduction Note"),
      m("paid", "Paid", { derived: true, total: true }), m("balance", "Balance", { derived: true, total: true }),
      d("settlementDate", "Settlement Date"), s("status", "Status", { required: true, enum: ["PENDING", "PARTIAL", "PAID", "CANCELLED"] }), s("remarks", "Remarks"), ...created,
    ],
    derive: (row, l) => {
      const trip = l.trips?.get(row.tripId);
      const hire = num(trip?.transporterHire), advance = num(trip?.advance), paid = l.settlementPaid?.get(row.id) ?? 0;
      return {
        tripNumber: trip?.tripNumber ?? "", transporterName: name(l, "transporters", row.transporterId), hire, advance, paid,
        balance: row.status === "CANCELLED" ? 0 : round2(hire - advance - num(row.deductions) - paid),
      };
    },
  },
  {
    key: "payments", name: "16_TransporterPayments", label: "Transporter Payments", model: "transporterPayment", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Payment ID"), s("code", "Payment Number", { required: true }), d("paymentDate", "Payment Date", { required: true }),
      r("transporterId", "Transporter ID", "transporters", true), s("transporterName", "Transporter", { derived: true, width: 24 }),
      r("settlementId", "Settlement ID", "settlements"), s("settlementCode", "Settlement Number", { derived: true }),
      m("amount", "Amount", { required: true, total: true }), s("mode", "Mode", { required: true }), s("reference", "Reference"), s("notes", "Notes"),
      s("status", "Status", { required: true, enum: ["ACTIVE", "CANCELLED"] }), s("createdBy", "Created By"), ...created,
    ],
    derive: (row, l) => ({ transporterName: name(l, "transporters", row.transporterId), settlementCode: name(l, "settlements", row.settlementId, "code") }),
  },
  {
    key: "documents", name: "17_Documents", label: "Documents", model: "document", idKey: "id", codeKey: "code", uniques: ["code"],
    columns: [
      id("Document ID"), s("code", "Document Number", { required: true }), s("docType", "Document Type", { required: true }), s("entityType", "Linked To"), s("entityId", "Linked Record ID", { width: 38 }),
      s("fileName", "File Name", { required: true, width: 30 }), s("storedName", "Stored File", { required: true, width: 40 }), s("mimeType", "File Type", { required: true }),
      { key: "sizeBytes", header: "Size (bytes)", type: "int", required: true }, s("sha256", "SHA-256", { required: true, width: 66 }), s("notes", "Notes"), s("uploadedBy", "Uploaded By"),
      { key: "createdAt", header: "Uploaded At", type: "datetime", width: 26 },
    ],
  },
  {
    key: "vehicleDocuments", name: "18_VehicleDocuments", label: "Vehicle Documents", model: "vehicleDocument", idKey: "id",
    columns: [
      id("Vehicle Document ID"), r("vehicleId", "Vehicle ID", "vehicles", true), s("vehicleNumber", "Vehicle", { derived: true }),
      s("docType", "Document Type", { required: true }), s("docNumber", "Document Number"), d("issueDate", "Issue Date"), d("expiryDate", "Expiry Date"),
      r("documentId", "Document ID", "documents"), s("notes", "Notes"), { key: "createdAt", header: "Created At", type: "datetime", width: 26 },
    ],
    derive: (row, l) => ({ vehicleNumber: name(l, "vehicles", row.vehicleId, "vehicleNumber") }),
  },
  {
    key: "driverDocuments", name: "19_DriverDocuments", label: "Driver Documents", model: "driverDocument", idKey: "id",
    columns: [
      id("Driver Document ID"), r("driverId", "Driver ID", "drivers", true), s("driverName", "Driver", { derived: true }),
      s("docType", "Document Type", { required: true }), s("docNumber", "Document Number"), d("issueDate", "Issue Date"), d("expiryDate", "Expiry Date"),
      r("documentId", "Document ID", "documents"), s("notes", "Notes"), { key: "createdAt", header: "Created At", type: "datetime", width: 26 },
    ],
    derive: (row, l) => ({ driverName: name(l, "drivers", row.driverId) }),
  },
  {
    key: "targets", name: "20_Targets", label: "Targets", model: "target", idKey: "id",
    columns: [
      id("Target ID"), s("period", "Period", { required: true, enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] }), s("metric", "Metric", { required: true, enum: ["PROFIT", "REVENUE", "TRIPS"] }),
      d("startDate", "Start Date", { required: true }), d("endDate", "End Date", { required: true }), m("amount", "Target", { required: true }), s("notes", "Notes"), ...created,
    ],
  },
  {
    key: "notifications", name: "21_Notifications", label: "Notifications", model: "notification", idKey: "id", uniques: ["key"],
    columns: [
      id("Notification ID"), s("key", "Key", { required: true, width: 40 }), s("type", "Type", { required: true }), s("severity", "Severity", { required: true }),
      s("title", "Title", { required: true, width: 30 }), s("message", "Message", { required: true, width: 50 }), s("entityType", "Linked To"), s("entityId", "Linked Record ID"),
      d("dueDate", "Due Date"), { key: "readAt", header: "Read At", type: "datetime" }, { key: "createdAt", header: "Created At", type: "datetime", width: 26 },
    ],
  },
  {
    key: "auditLogs", name: "22_AuditLogs", label: "Audit Logs", model: "auditLog", idKey: "id",
    columns: [
      id("Audit ID"), { key: "at", header: "Date Time", type: "datetime", required: true, width: 26 }, s("userId", "User ID"), s("userName", "User"),
      s("action", "Action", { required: true }), s("entityType", "Record Type"), s("entityId", "Record ID", { width: 38 }), s("recordCode", "Record Code"),
      { key: "oldValue", header: "Old Value", type: "json", width: 40 }, { key: "newValue", header: "New Value", type: "json", width: 40 }, s("ip", "IP"), s("device", "Device"),
    ],
  },
  {
    key: "settings", name: "23_Settings", label: "Settings", model: "setting", idKey: "key",
    columns: [s("key", "Setting", { required: true, width: 34 }), s("value", "Value", { width: 60 }), { key: "updatedAt", header: "Updated At", type: "datetime", width: 26 }],
  },
];

export const SHEET_BY_KEY = Object.fromEntries(SHEETS.map((s) => [s.key, s])) as Record<SheetKey, SheetDef>;

/** Parents before children: the order records are inserted on restore (and deleted in reverse). */
export const INSERT_ORDER: SheetKey[] = [
  "company", "settings", "customers", "transporters", "vehicles", "drivers", "loadingPoints", "deliveryPoints", "freight", "documents",
  "trips", "tripItems", "expenses", "invoices", "invoiceItems", "receipts", "settlements", "payments", "vehicleDocuments", "driverDocuments",
  "targets", "notifications", "auditLogs",
];

/** Settings that belong to this computer / installation and must never travel inside a backup. */
export const LOCAL_SETTING = (key: string) => key.startsWith("license.") || key.startsWith("local.");

export const INFO_SHEET = "00_BackupInfo";
