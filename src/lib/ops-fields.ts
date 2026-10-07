import type { FieldDef, Option } from "@/components/forms/entity-form";
import { opt } from "./fields";

export const pickupFields = (customers: Option[], sites: Option[], wasteTypes: Option[]): FieldDef[] => [
  { name: "customerId", label: "Customer", type: "select", options: customers, required: true },
  { name: "siteId", label: "Site", type: "select", options: sites, filterBy: "customerId", required: true },
  { name: "wasteTypeId", label: "Waste Type", type: "select", options: wasteTypes, required: true },
  { name: "requestedDate", label: "Requested Date", type: "date", required: true },
  { name: "requestedTime", label: "Requested Time", type: "time" },
  { name: "priority", label: "Priority", type: "select", options: opt(["LOW", "NORMAL", "HIGH", "URGENT"]) },
  { name: "estimatedQty", label: "Estimated Quantity (KG)", type: "number" },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const scheduleFields = (customers: Option[], sites: Option[], wasteTypes: Option[], vehicles: Option[], drivers: Option[]): FieldDef[] => [
  { name: "customerId", label: "Customer", type: "select", options: customers, required: true },
  { name: "siteId", label: "Site", type: "select", options: sites, filterBy: "customerId", required: true },
  { name: "wasteTypeId", label: "Waste Type", type: "select", options: wasteTypes, required: true },
  { name: "scheduledDate", label: "Date", type: "date", required: true },
  { name: "scheduledTime", label: "Time", type: "time" },
  { name: "vehicleId", label: "Vehicle", type: "select", options: vehicles },
  { name: "driverId", label: "Driver", type: "select", options: drivers },
  { name: "remarks", label: "Remarks", type: "textarea" },
];

export const collectionFields = (customers: Option[], sites: Option[], wasteTypes: Option[], vehicles: Option[], drivers: Option[]): FieldDef[] => [
  { name: "collectionDate", label: "Date & Time", type: "datetime", required: true },
  { name: "customerId", label: "Customer", type: "select", options: customers, required: true },
  { name: "siteId", label: "Site", type: "select", options: sites, filterBy: "customerId", required: true },
  { name: "vehicleId", label: "Vehicle", type: "select", options: vehicles, required: true },
  { name: "driverId", label: "Driver", type: "select", options: drivers },
  { name: "wasteTypeId", label: "Waste Type", type: "select", options: wasteTypes, required: true },
  { name: "estimatedQty", label: "Estimated Quantity (KG)", type: "number" },
  { name: "actualQty", label: "Actual Quantity (KG)", type: "number", help: "Weighbridge net weight is recorded separately" },
  { name: "status", label: "Completion Status", type: "select", options: opt(["COMPLETED", "PARTIAL", "NOT_COLLECTED"]) },
  { name: "remarks", label: "Remarks", type: "textarea" },
];
