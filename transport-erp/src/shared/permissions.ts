import type { Role } from "./calc.js";

export const PERMISSIONS = {
  "dashboard.view": "View dashboard",
  "masters.view": "View customers, transporters, vehicles, drivers, places",
  "masters.edit": "Create / edit masters",
  "trips.view": "View trips",
  "trips.edit": "Create / edit trips",
  "trips.cancel": "Cancel trips",
  "expenses.view": "View expenses",
  "expenses.edit": "Create / edit expenses",
  "billing.view": "View invoices and receipts",
  "billing.edit": "Create invoices and receipts",
  "settlements.view": "View transporter settlements and payments",
  "settlements.edit": "Settle and pay transporters",
  "profit.view": "View profit / loss and targets",
  "targets.edit": "Set targets",
  "reports.view": "View and export reports",
  "documents.view": "View documents",
  "documents.upload": "Upload documents",
  "backup.create": "Create and verify backups, export data",
  "backup.restore": "Restore / import data",
  "settings.edit": "Company and application settings",
  "users.manage": "Users and role permissions",
  "license.manage": "Install licence keys",
  "audit.view": "View audit log",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const VIEW: Permission[] = ["dashboard.view", "masters.view", "trips.view", "expenses.view", "billing.view", "settlements.view", "profit.view", "reports.view", "documents.view"];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS.filter((p) => p !== "license.manage"),
  TRANSPORT_MANAGER: [...VIEW, "masters.edit", "trips.edit", "trips.cancel", "expenses.edit", "billing.edit", "settlements.edit", "targets.edit", "documents.upload", "backup.create", "audit.view"],
  OPERATIONS: ["dashboard.view", "masters.view", "masters.edit", "trips.view", "trips.edit", "expenses.view", "expenses.edit", "documents.view", "documents.upload", "backup.create"],
  ACCOUNTS: [...VIEW, "expenses.edit", "billing.edit", "settlements.edit", "documents.upload", "backup.create"],
  VIEWER: VIEW,
};

/** Permissions a SUPER_ADMIN can never lose, so nobody can lock the company out of its own data. */
export const LOCKED_SUPER_ADMIN: Permission[] = ["users.manage", "backup.create", "backup.restore", "license.manage", "settings.edit"];
