import type { FieldDef, Option } from "@/components/forms/entity-form";
import { opt } from "./fields";

export const contractFields = (customers: Option[], lockCustomer = false): FieldDef[] => [
  { name: "customerId", label: "Customer", type: "select", options: customers, required: true, span: 2, readOnly: lockCustomer },
  { name: "status", label: "Status", type: "select", options: opt(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]) },
  { name: "title", label: "Contract Title", required: true, span: 2 },
  { name: "paymentTermsDays", label: "Payment Terms (days)", type: "number", step: "1" },
  { name: "startDate", label: "Start Date", type: "date", required: true },
  { name: "endDate", label: "End Date", type: "date" },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const rateFields = (sites: Option[], wasteTypes: Option[], gstRates: Option[]): FieldDef[] => [
  {
    name: "billingMethod",
    label: "Billing Method",
    type: "select",
    required: true,
    options: [
      { value: "WEIGHT", label: "Weight based (quantity × rate)" },
      { value: "TRIP", label: "Trip based (trips × rate)" },
      { value: "MONTHLY", label: "Monthly contract (fixed amount)" },
    ],
  },
  { name: "unit", label: "Rate Unit", type: "select", required: true, options: opt(["KG", "TONNE", "TRIP", "MONTH"], { KG: "Per KG", TONNE: "Per Tonne", TRIP: "Per Trip", MONTH: "Per Month" }) },
  { name: "rate", label: "Rate (₹)", type: "number", required: true },
  { name: "siteId", label: "Site (blank = all sites)", type: "select", options: sites, placeholder: "All sites" },
  { name: "wasteTypeId", label: "Waste Type (blank = all)", type: "select", options: wasteTypes, placeholder: "All waste types" },
  { name: "effectiveFrom", label: "Effective From", type: "date", required: true },
  { name: "taxTreatment", label: "Tax Treatment", type: "select", options: opt(["TAXABLE", "EXEMPT"]) },
  { name: "gstRateId", label: "GST Rate", type: "select", options: gstRates },
  { name: "sacCode", label: "SAC Code", placeholder: "999432" },
  { name: "description", label: "Invoice Description", type: "textarea", placeholder: "e.g. Dry waste collection & processing" },
];
