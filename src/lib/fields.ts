import type { FieldDef, Option } from "@/components/forms/entity-form";
import { STATES } from "./utils";
import { FREQUENCIES, VEHICLE_TYPES } from "./validation";

export const opt = (values: readonly string[], labels?: Record<string, string>): Option[] =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

export const STATUS_OPTIONS = opt(["ACTIVE", "INACTIVE"]);
export const STATE_OPTIONS: Option[] = Object.entries(STATES).map(([code, name]) => ({ value: code, label: `${code} - ${name}` }));
export const PAYMENT_MODE_OPTIONS = opt(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"]);

export const customerFields = (): FieldDef[] => [
  { name: "name", label: "Customer Name", required: true, span: 2, section: "Customer" },
  { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
  { name: "gstin", label: "GSTIN", placeholder: "33ABCDE1234F1Z5", help: "State is taken from the GSTIN" },
  { name: "stateCode", label: "State (if no GSTIN)", type: "select", options: STATE_OPTIONS },
  { name: "creditDays", label: "Credit Period (days)", type: "number", step: "1" },
  { name: "contactPerson", label: "Contact Person", section: "Contact" },
  { name: "mobile", label: "Mobile", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "address", label: "Address", span: 2 },
  { name: "city", label: "City" },
  { name: "pincode", label: "PIN Code" },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const siteFields = (customers: Option[], wasteTypes: Option[]): FieldDef[] => [
  { name: "customerId", label: "Customer", type: "select", options: customers, required: true, span: 2 },
  { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
  { name: "name", label: "Site Name", required: true, span: 2 },
  { name: "defaultWasteTypeId", label: "Waste Type", type: "select", options: wasteTypes },
  { name: "address", label: "Address", span: 2 },
  { name: "frequency", label: "Collection Frequency", type: "select", options: opt(FREQUENCIES) },
  { name: "collectionTime", label: "Collection Timing", type: "time" },
  { name: "contactName", label: "Site Contact" },
  { name: "contactMobile", label: "Contact Mobile", type: "tel" },
  { name: "latitude", label: "GPS Latitude", type: "number", placeholder: "11.0168" },
  { name: "longitude", label: "GPS Longitude", type: "number", placeholder: "76.9558" },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const contactFields = (): FieldDef[] => [
  { name: "name", label: "Name", required: true },
  { name: "designation", label: "Designation" },
  { name: "mobile", label: "Mobile", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "isPrimary", label: "Primary", type: "checkbox", help: "Primary contact" },
];

export const vehicleFields = (drivers: Option[]): FieldDef[] => [
  { name: "number", label: "Vehicle Number", required: true, placeholder: "TN 37 AB 1234", section: "Vehicle" },
  { name: "type", label: "Vehicle Type", type: "select", options: opt(VEHICLE_TYPES, Object.fromEntries(VEHICLE_TYPES.map((v) => [v, v]))), required: true },
  { name: "status", label: "Status", type: "select", options: opt(["ACTIVE", "UNDER_MAINTENANCE", "INACTIVE"]) },
  { name: "capacityKg", label: "Capacity (KG)", type: "number", required: true },
  { name: "standardTareKg", label: "Standard Tare (KG)", type: "number", help: "Empty vehicle weight for reference" },
  { name: "fuelType", label: "Fuel Type", type: "select", options: opt(["DIESEL", "PETROL", "CNG", "ELECTRIC"]) },
  { name: "ownership", label: "Ownership", type: "select", options: opt(["OWNED", "HIRED"]) },
  { name: "ownerName", label: "Owner (if hired)" },
  { name: "defaultDriverId", label: "Default Driver", type: "select", options: drivers },
  { name: "rcNumber", label: "RC Number", section: "Documents & expiry dates" },
  { name: "rcExpiry", label: "RC Expiry", type: "date" },
  { name: "insuranceExpiry", label: "Insurance Expiry", type: "date" },
  { name: "fcExpiry", label: "FC Expiry", type: "date" },
  { name: "pollutionExpiry", label: "Pollution (PUC) Expiry", type: "date" },
  { name: "permitExpiry", label: "Permit Expiry", type: "date" },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const driverFields = (): FieldDef[] => [
  { name: "name", label: "Driver Name", required: true },
  { name: "mobile", label: "Mobile", type: "tel" },
  { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
  { name: "licenceNumber", label: "Licence Number", required: true },
  { name: "licenceExpiry", label: "Licence Expiry", type: "date" },
  { name: "joiningDate", label: "Joining Date", type: "date" },
  { name: "address", label: "Address", span: 3 },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const partyFields = (kind: "Buyer" | "Supplier"): FieldDef[] => [
  { name: "name", label: `${kind} Name`, required: true, span: 2 },
  { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
  { name: "gstin", label: "GSTIN" },
  { name: "stateCode", label: "State (if no GSTIN)", type: "select", options: STATE_OPTIONS },
  { name: "paymentTermsDays", label: "Payment Terms (days)", type: "number", step: "1" },
  { name: "contactPerson", label: "Contact Person" },
  { name: "mobile", label: "Mobile", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "address", label: "Address", span: 3 },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const wasteTypeFields = (categories: Option[]): FieldDef[] => [
  { name: "code", label: "Code", required: true },
  { name: "name", label: "Name", required: true },
  { name: "categoryId", label: "Category", type: "select", options: categories, required: true },
  { name: "unit", label: "Unit", type: "select", options: opt(["KG", "TONNE", "NOS"], { KG: "KG", TONNE: "Tonne", NOS: "Nos" }) },
  { name: "hsnSac", label: "HSN / SAC" },
  { name: "isRecyclable", label: "Recyclable", type: "checkbox", help: "Recyclable material" },
  { name: "active", label: "Active", type: "checkbox", help: "Active" },
  { name: "description", label: "Description", type: "textarea" },
];

export const wasteCategoryFields = (): FieldDef[] => [
  { name: "code", label: "Code", required: true },
  { name: "name", label: "Name", required: true },
  { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
  { name: "description", label: "Description", type: "textarea" },
];

export const locationFields = (branches: Option[]): FieldDef[] => [
  { name: "code", label: "Code", required: true },
  { name: "name", label: "Name", required: true },
  { name: "branchId", label: "Branch", type: "select", options: branches, required: true },
  { name: "type", label: "Type", type: "select", options: opt(["YARD", "STORE", "PROCESSING"]) },
  { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
];

export const expenseCategoryFields = (accounts: Option[]): FieldDef[] => [
  { name: "code", label: "Code", required: true },
  { name: "name", label: "Name", required: true },
  { name: "accountId", label: "Ledger Account", type: "select", options: accounts },
  { name: "active", label: "Active", type: "checkbox", help: "Active" },
];

export const gstRateFields = (): FieldDef[] => [
  { name: "name", label: "Name", required: true, placeholder: "GST 18%" },
  { name: "rate", label: "Rate (%)", type: "number", required: true },
  { name: "active", label: "Active", type: "checkbox", help: "Active" },
  { name: "description", label: "Description", type: "textarea" },
];

export const inventoryItemFields = (wasteTypes: Option[], gstRates: Option[]): FieldDef[] => [
  { name: "code", label: "Code", required: true },
  { name: "name", label: "Name", required: true },
  { name: "itemType", label: "Item Type", type: "select", options: opt(["RAW", "RECOVERED", "REJECT", "OTHER"], { RAW: "Raw / unprocessed waste", RECOVERED: "Recovered material", REJECT: "Rejected waste", OTHER: "Other" }), required: true },
  { name: "wasteTypeId", label: "Waste Type", type: "select", options: wasteTypes },
  { name: "unit", label: "Unit", type: "select", options: opt(["KG", "NOS"], { KG: "KG", NOS: "Nos" }) },
  { name: "hsnCode", label: "HSN Code" },
  { name: "gstRateId", label: "GST Rate (sales)", type: "select", options: gstRates },
  { name: "defaultSaleRate", label: "Default Sale Rate / KG", type: "number" },
  { name: "reorderLevel", label: "Low Stock Alert Level", type: "number" },
  { name: "isSaleable", label: "Saleable", type: "checkbox", help: "Can be sold to buyers" },
  { name: "allowNegative", label: "Allow negative stock", type: "checkbox", help: "Allow negative stock (admin decision)" },
  { name: "active", label: "Active", type: "checkbox", help: "Active" },
];

/** Convert a DB record into string form values for EntityForm defaults. */
export function toFormValues(rec: Record<string, any> | null | undefined): Record<string, unknown> {
  if (!rec) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || v === undefined) out[k] = "";
    else if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
    else if (typeof v === "object" && "toFixed" in v) out[k] = String(v);
    else if (typeof v === "object") continue; // relations are not form fields
    else out[k] = v;
  }
  return out;
}
