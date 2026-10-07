/**
 * Permission catalogue. Permission codes are "<module>.<action>".
 * "view" = read access, "manage" = create/edit/cancel, plus a few special actions.
 * This file is shared by server (enforcement) and client (menu visibility).
 */
export const MODULES = [
  { key: "dashboard", label: "Dashboard", actions: ["view"] },
  { key: "customers", label: "Customers & Sites", actions: ["view", "manage"] },
  { key: "contracts", label: "Contracts & Rates", actions: ["view", "manage"] },
  { key: "pickups", label: "Pickups & Schedules", actions: ["view", "manage"] },
  { key: "collections", label: "Field Collection", actions: ["view", "manage"] },
  { key: "weighments", label: "Weighment", actions: ["view", "manage", "override"] },
  { key: "processing", label: "Waste Processing", actions: ["view", "manage"] },
  { key: "inventory", label: "Inventory", actions: ["view", "manage", "override"] },
  { key: "sales", label: "Recyclable Sales & Buyers", actions: ["view", "manage"] },
  { key: "purchases", label: "Purchases & Suppliers", actions: ["view", "manage"] },
  { key: "expenses", label: "Expenses", actions: ["view", "manage"] },
  { key: "vehicles", label: "Vehicles", actions: ["view", "manage"] },
  { key: "drivers", label: "Drivers", actions: ["view", "manage"] },
  { key: "billing", label: "Billing & Invoices", actions: ["view", "manage"] },
  { key: "receipts", label: "Receipts & Payments", actions: ["view", "manage"] },
  { key: "accounts", label: "Accounts", actions: ["view", "manage"] },
  { key: "gst", label: "GST", actions: ["view", "manage"] },
  { key: "reports", label: "Reports", actions: ["view", "financial"] },
  { key: "masters", label: "Master Data", actions: ["view", "manage"] },
  { key: "documents", label: "Documents", actions: ["view", "manage"] },
  { key: "users", label: "User Management", actions: ["view", "manage"] },
  { key: "settings", label: "Settings", actions: ["view", "manage"] },
  { key: "audit", label: "Audit Trail", actions: ["view"] },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

export const ACTION_LABELS: Record<string, string> = {
  view: "View",
  manage: "Create / Edit / Cancel",
  override: "Admin Override",
  financial: "Financial Reports",
};

export const ALL_PERMISSIONS: string[] = MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a}`));

const viewAll = MODULES.flatMap((m) => (m.actions as readonly string[]).includes("view") ? [`${m.key}.view`] : []);

export const ROLE_DEFINITIONS: { code: string; name: string; description: string; permissions: string[] }[] = [
  { code: "ADMIN", name: "Administrator", description: "Full access to every module", permissions: ALL_PERMISSIONS },
  {
    code: "MANAGEMENT",
    name: "Management",
    description: "Dashboard, reports, profitability, operations and financial visibility (read-only)",
    permissions: [...viewAll.filter((p) => !["users.view", "settings.view"].includes(p)), "reports.financial"],
  },
  {
    code: "OPERATIONS",
    name: "Operations",
    description: "Customers, pickups, schedules, collection, vehicles and drivers",
    permissions: [
      "dashboard.view", "customers.view", "customers.manage", "contracts.view", "pickups.view", "pickups.manage",
      "collections.view", "collections.manage", "vehicles.view", "vehicles.manage", "drivers.view", "drivers.manage",
      "weighments.view", "masters.view", "documents.view", "documents.manage", "reports.view",
    ],
  },
  {
    code: "WEIGHBRIDGE",
    name: "Weighbridge / Store",
    description: "Weighment, stock receiving and material movement",
    permissions: [
      "dashboard.view", "weighments.view", "weighments.manage", "inventory.view", "inventory.manage",
      "collections.view", "pickups.view", "customers.view", "vehicles.view", "drivers.view", "masters.view",
      "documents.view", "documents.manage", "reports.view",
    ],
  },
  {
    code: "PROCESSING",
    name: "Processing",
    description: "Segregation and processing entries",
    permissions: [
      "dashboard.view", "processing.view", "processing.manage", "inventory.view", "weighments.view", "masters.view",
      "documents.view", "reports.view",
    ],
  },
  {
    code: "SALES",
    name: "Sales / Purchase",
    description: "Recyclable sales, buyers, purchases and suppliers",
    permissions: [
      "dashboard.view", "sales.view", "sales.manage", "purchases.view", "purchases.manage", "inventory.view",
      "masters.view", "documents.view", "documents.manage", "reports.view", "receipts.view",
    ],
  },
  {
    code: "ACCOUNTS",
    name: "Accounts",
    description: "Billing, invoices, receipts, payments, GST and accounting",
    permissions: [
      "dashboard.view", "billing.view", "billing.manage", "receipts.view", "receipts.manage", "accounts.view",
      "accounts.manage", "gst.view", "gst.manage", "expenses.view", "expenses.manage", "purchases.view", "sales.view",
      "customers.view", "contracts.view", "weighments.view", "collections.view", "vehicles.view", "masters.view",
      "documents.view", "documents.manage", "reports.view", "reports.financial",
    ],
  },
];

export type NavItem = { href: string; label: string; icon: string; permission: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "dashboard.view" },
      { href: "/field", label: "Field Tasks", icon: "Smartphone", permission: "collections.manage" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/customers", label: "Customers", icon: "Building2", permission: "customers.view" },
      { href: "/sites", label: "Customer Sites", icon: "MapPin", permission: "customers.view" },
      { href: "/contracts", label: "Contracts & Rates", icon: "FileSignature", permission: "contracts.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/pickups", label: "Pickup Requests", icon: "ClipboardList", permission: "pickups.view" },
      { href: "/schedule", label: "Collection Schedule", icon: "CalendarDays", permission: "pickups.view" },
      { href: "/collections", label: "Collections", icon: "Truck", permission: "collections.view" },
      { href: "/weighments", label: "Weighment", icon: "Scale", permission: "weighments.view" },
      { href: "/processing", label: "Waste Processing", icon: "Recycle", permission: "processing.view" },
      { href: "/inventory", label: "Inventory / Stock", icon: "Boxes", permission: "inventory.view" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: "Bus", permission: "vehicles.view" },
      { href: "/drivers", label: "Drivers", icon: "IdCard", permission: "drivers.view" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/sales", label: "Recyclable Sales", icon: "BadgeIndianRupee", permission: "sales.view" },
      { href: "/buyers", label: "Buyers", icon: "Handshake", permission: "sales.view" },
      { href: "/purchases", label: "Purchases", icon: "ShoppingCart", permission: "purchases.view" },
      { href: "/suppliers", label: "Suppliers", icon: "Factory", permission: "purchases.view" },
      { href: "/expenses", label: "Expenses", icon: "Wallet", permission: "expenses.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/invoices", label: "Billing & Invoices", icon: "FileText", permission: "billing.view" },
      { href: "/receipts", label: "Receipts", icon: "HandCoins", permission: "receipts.view" },
      { href: "/payments", label: "Supplier Payments", icon: "Banknote", permission: "receipts.view" },
      { href: "/outstanding", label: "Customer Outstanding", icon: "AlarmClock", permission: "receipts.view" },
      { href: "/accounts", label: "Accounts", icon: "BookOpen", permission: "accounts.view" },
      { href: "/gst", label: "GST", icon: "Percent", permission: "gst.view" },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: "BarChart3", permission: "reports.view" }],
  },
  {
    label: "Administration",
    items: [
      { href: "/masters", label: "Master Data", icon: "Database", permission: "masters.view" },
      { href: "/documents", label: "Documents", icon: "FolderOpen", permission: "documents.view" },
      { href: "/users", label: "Users & Roles", icon: "Users", permission: "users.view" },
      { href: "/settings", label: "Settings", icon: "Settings", permission: "settings.view" },
      { href: "/audit", label: "Audit Trail", icon: "ShieldCheck", permission: "audit.view" },
    ],
  },
];
