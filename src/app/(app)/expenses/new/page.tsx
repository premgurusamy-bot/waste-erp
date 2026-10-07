import { expenseAction } from "@/app/actions/trade";
import { EntityForm } from "@/components/forms/entity-form";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { PAYMENT_MODE_OPTIONS } from "@/lib/fields";
import { todayISO } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";
import { cashBankOptions, expenseCategoryOptions, supplierOptions, vehicleOptions } from "@/server/options";

export const metadata = { title: "New Expense" };

export default async function NewExpense() {
  await requirePermission("expenses.manage");
  const [cats, suppliers, vehicles, accounts] = await Promise.all([expenseCategoryOptions(), supplierOptions(), vehicleOptions(true), cashBankOptions()]);
  return (
    <>
      <PageHeader title="New Expense" description="Attach the bill after saving" crumbs={[{ href: "/expenses", label: "Expenses" }]} />
      <Card><CardContent>
        <EntityForm
          schemaKey="expense"
          fields={[
            { name: "date", label: "Date", type: "date", required: true },
            { name: "categoryId", label: "Category", type: "select", options: cats, required: true },
            { name: "supplierId", label: "Supplier / Payee", type: "select", options: suppliers, help: "Required for credit expenses" },
            { name: "description", label: "Description", span: 2 },
            { name: "vehicleId", label: "Vehicle (if vehicle-related)", type: "select", options: vehicles },
            { name: "amount", label: "Amount (excl. GST)", type: "number", required: true },
            { name: "gstRate", label: "GST %", type: "number", help: "Input GST claimable" },
            { name: "paymentMode", label: "Payment Mode", type: "select", options: [...PAYMENT_MODE_OPTIONS, { value: "CREDIT", label: "Credit (pay later)" }], required: true },
            { name: "accountId", label: "Paid From (cash / bank)", type: "select", options: accounts },
            { name: "reference", label: "Reference / Bill No." },
            { name: "remarks", label: "Remarks", type: "textarea" },
          ]}
          defaultValues={{ date: todayISO(), paymentMode: "CASH", gstRate: "0", accountId: accounts[0]?.value ?? "" }}
          action={expenseAction}
          submitLabel="Save Expense"
          redirectTo="/expenses/:id"
          successMessage="Expense recorded"
          cancelHref="/expenses"
        />
      </CardContent></Card>
    </>
  );
}
