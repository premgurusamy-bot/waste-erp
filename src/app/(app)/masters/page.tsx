import { Pencil, Plus } from "lucide-react";
import { saveEntityAction } from "@/app/actions/masters";
import { FormDialog } from "@/components/forms/confirm-action";
import { EntityForm, type FieldDef } from "@/components/forms/entity-form";
import { ActiveToggle } from "@/components/shared/active-toggle";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LinkTabs, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { expenseCategoryFields, inventoryItemFields, locationFields, toFormValues, wasteCategoryFields, wasteTypeFields } from "@/lib/fields";
import { str, type SP } from "@/lib/list-params";
import type { SchemaKey } from "@/lib/schema-registry";
import { formatMoney, formatQty, num } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { branchOptions, gstRateOptions, ledgerOptions, wasteCategoryOptions, wasteTypeOptions } from "@/server/options";
import type { EntityKey } from "@/server/services/masters";

export const metadata = { title: "Master Data" };

type Tab = { key: string; label: string; entity: EntityKey & SchemaKey };
const TABS: Tab[] = [
  { key: "waste-types", label: "Waste Types", entity: "wasteType" },
  { key: "waste-categories", label: "Waste Categories", entity: "wasteCategory" },
  { key: "materials", label: "Materials / Stock Items", entity: "inventoryItem" },
  { key: "locations", label: "Locations", entity: "location" },
  { key: "expense-categories", label: "Expense Categories", entity: "expenseCategory" },
];

export default async function MastersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("masters.view");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === str(sp, "tab")) ?? TABS[0];
  const manage = user.permissions.includes("masters.manage");

  let fields: FieldDef[] = [];
  let rows: any[] = [];
  let columns: Column<any>[] = [];
  let defaults: Record<string, unknown> = {};
  let isActive: (r: any) => boolean = (r) => r.status === "ACTIVE" || r.active === true;

  switch (tab.entity) {
    case "wasteType": {
      fields = wasteTypeFields(await wasteCategoryOptions());
      rows = await prisma.wasteType.findMany({ include: { category: true }, orderBy: { name: "asc" } });
      defaults = { unit: "KG", active: true };
      columns = [
        { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { key: "n", header: "Name", cell: (r) => <b className="font-medium">{r.name}</b> },
        { key: "cat", header: "Category", cell: (r) => r.category.name },
        { key: "u", header: "Unit", cell: (r) => r.unit },
        { key: "rec", header: "Recyclable", cell: (r) => (r.isRecyclable ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>) },
        { key: "h", header: "HSN/SAC", cell: (r) => r.hsnSac },
      ];
      break;
    }
    case "wasteCategory":
      fields = wasteCategoryFields();
      rows = await prisma.wasteCategory.findMany({ include: { _count: { select: { wasteTypes: true } } }, orderBy: { name: "asc" } });
      defaults = { status: "ACTIVE" };
      columns = [
        { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { key: "n", header: "Name", cell: (r) => r.name },
        { key: "w", header: "Waste Types", align: "right", cell: (r) => r._count.wasteTypes },
        { key: "d", header: "Description", cell: (r) => r.description },
      ];
      break;
    case "inventoryItem": {
      const [wts, gst] = await Promise.all([wasteTypeOptions(), gstRateOptions()]);
      fields = inventoryItemFields(wts, gst);
      rows = await prisma.inventoryItem.findMany({ include: { wasteType: true, gstRate: true }, orderBy: [{ itemType: "asc" }, { name: "asc" }] });
      defaults = { unit: "KG", itemType: "RECOVERED", active: true, isSaleable: true };
      columns = [
        { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { key: "n", header: "Name", cell: (r) => r.name },
        { key: "t", header: "Type", cell: (r) => <Badge tone={r.itemType === "RECOVERED" ? "green" : r.itemType === "RAW" ? "amber" : r.itemType === "REJECT" ? "red" : "grey"}>{r.itemType}</Badge> },
        { key: "w", header: "Waste Type", cell: (r) => r.wasteType?.name },
        { key: "h", header: "HSN", cell: (r) => r.hsnCode },
        { key: "g", header: "GST", cell: (r) => r.gstRate?.name },
        { key: "r", header: "Sale Rate", align: "right", cell: (r) => (r.defaultSaleRate ? formatMoney(r.defaultSaleRate) : "") },
        { key: "rl", header: "Low Stock Level", align: "right", cell: (r) => (r.reorderLevel ? formatQty(num(r.reorderLevel)) : "") },
        { key: "s", header: "Saleable", cell: (r) => (r.isSaleable ? "Yes" : "No") },
      ];
      break;
    }
    case "location":
      fields = locationFields(await branchOptions());
      rows = await prisma.location.findMany({ include: { branch: true }, orderBy: { code: "asc" } });
      defaults = { status: "ACTIVE", type: "YARD" };
      columns = [
        { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { key: "n", header: "Name", cell: (r) => r.name },
        { key: "t", header: "Type", cell: (r) => r.type },
        { key: "b", header: "Branch", cell: (r) => r.branch.name },
      ];
      break;
    case "expenseCategory":
      fields = expenseCategoryFields(await ledgerOptions());
      rows = await prisma.expenseCategory.findMany({ include: { account: true }, orderBy: { name: "asc" } });
      defaults = { active: true };
      columns = [
        { key: "c", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { key: "n", header: "Name", cell: (r) => r.name },
        { key: "a", header: "Ledger Account", cell: (r) => (r.account ? `${r.account.code} ${r.account.name}` : "") },
      ];
      break;
  }
  if (tab.entity === "wasteType" || tab.entity === "inventoryItem" || tab.entity === "expenseCategory") isActive = (r) => r.active;

  return (
    <>
      <PageHeader
        title="Master Data"
        description="Waste classification, materials, locations and expense categories"
        actions={manage && (
          <FormDialog label={`New ${tab.label.replace(/s$/, "").replace(/ies$/, "y")}`} icon={<Plus />} title={`New ${tab.label}`} variant="default" size="md" wide>
            <EntityForm schemaKey={tab.entity} cols={2} fields={fields} defaultValues={defaults} action={saveEntityAction.bind(null, tab.entity, null)} successMessage="Created" />
          </FormDialog>
        )}
      />
      <LinkTabs base="/masters" active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      {tab.entity === "wasteType" && <p className="mb-3 text-xs text-slate-500">Creating a waste type automatically creates its “Unprocessed” stock item, so weighed waste can be tracked in inventory.</p>}
      <Card>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            ...columns,
            { key: "st", header: "Status", cell: (r) => <StatusBadge status={isActive(r) ? "ACTIVE" : "INACTIVE"} /> },
            ...(manage
              ? [{
                  key: "act",
                  header: "",
                  cell: (r: any) => (
                    <div className="flex justify-end gap-1">
                      <FormDialog label="" icon={<Pencil />} variant="ghost" title={`Edit ${r.name}`} wide>
                        <EntityForm schemaKey={tab.entity} cols={2} fields={fields} defaultValues={toFormValues(r)} action={saveEntityAction.bind(null, tab.entity, r.id)} successMessage="Updated" />
                      </FormDialog>
                      <ActiveToggle entity={tab.entity} id={r.id} active={isActive(r)} label={r.name} />
                    </div>
                  ),
                }]
              : []),
          ]}
        />
      </Card>
    </>
  );
}
