import { prisma } from "@/lib/db";
import { addDays, dateOnly, daysBetween, formatDate, localDayRange, num, round2, round3, todayISO, toISODate } from "@/lib/utils";

export type FilterKey = "date" | "customer" | "wasteType" | "vehicle" | "driver" | "q";
export type ColType = "text" | "date" | "datetime" | "qty" | "money" | "int" | "pct";
export type ReportColumn = { key: string; label: string; type?: ColType; total?: boolean };
export type ReportFilters = {
  from: string;
  to: string;
  customerId?: string;
  wasteTypeId?: string;
  vehicleId?: string;
  driverId?: string;
  q?: string;
};
export type Row = Record<string, string | number | null>;
export type ReportDef = {
  key: string;
  title: string;
  group: "Operations" | "Inventory & Sales" | "Finance" | "Administration";
  description: string;
  permissions: string[]; // all required
  filters: FilterKey[];
  columns: ReportColumn[];
  run: (f: ReportFilters) => Promise<Row[]>;
};

const dRange = (f: ReportFilters) => ({ gte: dateOnly(f.from), lte: dateOnly(f.to) });
const tRange = (f: ReportFilters) => localDayRange(f.from, f.to);
const localDay = (d: Date) => todayISO(d);

async function weighmentRows(f: ReportFilters) {
  return prisma.weighment.findMany({
    where: {
      status: "COMPLETED",
      gateInAt: tRange(f),
      customerId: f.customerId || undefined,
      wasteTypeId: f.wasteTypeId || undefined,
      vehicleId: f.vehicleId || undefined,
      driverId: f.driverId || undefined,
    },
    include: { customer: true, site: true, vehicle: true, driver: true, wasteType: true, location: true },
    orderBy: { gateInAt: "asc" },
    take: 20000,
  });
}

async function collectionRows(f: ReportFilters) {
  return prisma.collectionEntry.findMany({
    where: {
      status: { in: ["COMPLETED", "PARTIAL"] },
      collectionDate: tRange(f),
      customerId: f.customerId || undefined,
      wasteTypeId: f.wasteTypeId || undefined,
      vehicleId: f.vehicleId || undefined,
      driverId: f.driverId || undefined,
    },
    include: { customer: true, site: true, vehicle: true, driver: true, wasteType: true },
    take: 20000,
  });
}

/** Group trips (collection entries) and weight (weighments) by a key. */
async function collectionSummary(f: ReportFilters, keyOf: (x: any) => [string, string] | null) {
  const [ws, cs] = await Promise.all([weighmentRows(f), collectionRows(f)]);
  const map = new Map<string, Row>();
  const get = (k: string, name: string) => {
    if (!map.has(k)) map.set(k, { name, trips: 0, weighments: 0, netKg: 0, avgKg: 0 });
    return map.get(k)!;
  };
  for (const c of cs) {
    const k = keyOf(c);
    if (k) (get(k[0], k[1]).trips as number)++;
  }
  for (const w of ws) {
    const k = keyOf(w);
    if (!k) continue;
    const r = get(k[0], k[1]);
    (r.weighments as number)++;
    r.netKg = round3((r.netKg as number) + num(w.netWeight));
  }
  const rows: Row[] = [...map.values()].map((r) => ({ ...r, avgKg: (r.weighments as number) ? round3((r.netKg as number) / (r.weighments as number)) : 0 }));
  return rows.sort((a, b) => (b.netKg as number) - (a.netKg as number));
}

const collCols = (first: string): ReportColumn[] => [
  { key: "name", label: first },
  { key: "trips", label: "Collection Trips", type: "int", total: true },
  { key: "weighments", label: "Weighments", type: "int", total: true },
  { key: "netKg", label: "Net Weight (KG)", type: "qty", total: true },
  { key: "avgKg", label: "Avg per Weighment (KG)", type: "qty" },
];

const ALL_COLL_FILTERS: FilterKey[] = ["date", "customer", "wasteType", "vehicle", "driver", "q"];

export const REPORTS: ReportDef[] = [
  {
    key: "daily-collection",
    title: "Daily Collection",
    group: "Operations",
    description: "Trips, weighments and net waste collected per day",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "trips", label: "Collection Trips", type: "int", total: true },
      { key: "weighments", label: "Weighments", type: "int", total: true },
      { key: "customers", label: "Customers Served", type: "int" },
      { key: "netKg", label: "Net Weight (KG)", type: "qty", total: true },
    ],
    run: async (f) => {
      const [ws, cs] = await Promise.all([weighmentRows(f), collectionRows(f)]);
      const map = new Map<string, { trips: number; weighments: number; netKg: number; cust: Set<string> }>();
      const g = (d: string) => map.get(d) ?? map.set(d, { trips: 0, weighments: 0, netKg: 0, cust: new Set() }).get(d)!;
      for (const c of cs) {
        const r = g(localDay(c.collectionDate));
        r.trips++;
        r.cust.add(c.customerId);
      }
      for (const w of ws) {
        const r = g(localDay(w.gateInAt));
        r.weighments++;
        r.netKg = round3(r.netKg + num(w.netWeight));
        r.cust.add(w.customerId);
      }
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, r]) => ({ date, trips: r.trips, weighments: r.weighments, customers: r.cust.size, netKg: r.netKg }));
    },
  },
  {
    key: "customer-collection",
    title: "Customer-wise Collection",
    group: "Operations",
    description: "Waste collected per customer",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: collCols("Customer"),
    run: (f) => collectionSummary(f, (x) => [x.customerId, x.customer.name]),
  },
  {
    key: "site-collection",
    title: "Site-wise Collection",
    group: "Operations",
    description: "Waste collected per customer site",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: collCols("Site"),
    run: (f) => collectionSummary(f, (x) => (x.site ? [x.siteId, `${x.site.name} (${x.customer.name})`] : ["none", "Site not recorded"])),
  },
  {
    key: "vehicle-collection",
    title: "Vehicle-wise Collection",
    group: "Operations",
    description: "Trips and waste moved per vehicle",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: collCols("Vehicle"),
    run: (f) => collectionSummary(f, (x) => [x.vehicleId, x.vehicle.number]),
  },
  {
    key: "driver-collection",
    title: "Driver-wise Collection",
    group: "Operations",
    description: "Trips and waste collected per driver",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: collCols("Driver"),
    run: (f) => collectionSummary(f, (x) => (x.driver ? [x.driverId, x.driver.name] : ["none", "Driver not recorded"])),
  },
  {
    key: "waste-type",
    title: "Waste Type Analysis",
    group: "Operations",
    description: "Share of each waste type in total received weight",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: [
      { key: "name", label: "Waste Type" },
      { key: "category", label: "Category" },
      { key: "weighments", label: "Weighments", type: "int", total: true },
      { key: "netKg", label: "Net Weight (KG)", type: "qty", total: true },
      { key: "share", label: "Share %", type: "pct" },
    ],
    run: async (f) => {
      const ws = await weighmentRows(f);
      const cats = new Map((await prisma.wasteCategory.findMany()).map((c) => [c.id, c.name]));
      const map = new Map<string, Row>();
      let total = 0;
      for (const w of ws) {
        const r = map.get(w.wasteTypeId) ?? { name: w.wasteType.name, category: cats.get(w.wasteType.categoryId) ?? "", weighments: 0, netKg: 0, share: 0 };
        (r.weighments as number)++;
        r.netKg = round3((r.netKg as number) + num(w.netWeight));
        total += num(w.netWeight);
        map.set(w.wasteTypeId, r);
      }
      return [...map.values()].map((r): Row => ({ ...r, share: total ? round2(((r.netKg as number) / total) * 100) : 0 })).sort((a, b) => (b.netKg as number) - (a.netKg as number));
    },
  },
  {
    key: "weighment",
    title: "Weighment Register",
    group: "Operations",
    description: "Every completed weighment with gross, tare and net weights",
    permissions: ["reports.view", "weighments.view"],
    filters: ALL_COLL_FILTERS,
    columns: [
      { key: "number", label: "Weighment ID" },
      { key: "gateIn", label: "Gate In", type: "datetime" },
      { key: "vehicle", label: "Vehicle" },
      { key: "customer", label: "Customer" },
      { key: "site", label: "Site" },
      { key: "wasteType", label: "Waste Type" },
      { key: "slip", label: "Slip No" },
      { key: "gross", label: "Gross (KG)", type: "qty", total: true },
      { key: "tare", label: "Tare (KG)", type: "qty", total: true },
      { key: "net", label: "Net (KG)", type: "qty", total: true },
      { key: "override", label: "Override" },
    ],
    run: async (f) =>
      (await weighmentRows(f)).map((w) => ({
        number: w.number,
        gateIn: w.gateInAt.toISOString(),
        vehicle: w.vehicle.number,
        customer: w.customer.name,
        site: w.site?.name ?? "",
        wasteType: w.wasteType.name,
        slip: w.slipNumber ?? "",
        gross: num(w.grossWeight),
        tare: num(w.tareWeight),
        net: num(w.netWeight),
        override: w.isNetOverridden ? `Yes: ${w.overrideReason}` : "",
      })),
  },
  {
    key: "processing",
    title: "Processing Batches",
    group: "Operations",
    description: "Input, recovered output, rejection and process loss per batch",
    permissions: ["reports.view", "processing.view"],
    filters: ["date", "q"],
    columns: [
      { key: "number", label: "Processing ID" },
      { key: "batchNo", label: "Batch No" },
      { key: "date", label: "Date", type: "date" },
      { key: "location", label: "Location" },
      { key: "input", label: "Input (KG)", type: "qty", total: true },
      { key: "output", label: "Recovered (KG)", type: "qty", total: true },
      { key: "rejected", label: "Rejected (KG)", type: "qty", total: true },
      { key: "loss", label: "Loss (KG)", type: "qty", total: true },
      { key: "recovery", label: "Recovery %", type: "pct" },
    ],
    run: async (f) =>
      (
        await prisma.processingBatch.findMany({ where: { status: "POSTED", date: dRange(f) }, include: { location: true }, orderBy: { date: "asc" } })
      ).map((b) => ({
        number: b.number,
        batchNo: b.batchNo,
        date: toISODate(b.date),
        location: b.location.name,
        input: num(b.inputQty),
        output: num(b.outputQty),
        rejected: num(b.rejectedQty),
        loss: num(b.lossQty),
        recovery: num(b.inputQty) ? round2((num(b.outputQty) / num(b.inputQty)) * 100) : 0,
      })),
  },
  {
    key: "recovery",
    title: "Material Recovery",
    group: "Operations",
    description: "Recovered material quantities from processing",
    permissions: ["reports.view", "processing.view"],
    filters: ["date", "q"],
    columns: [
      { key: "material", label: "Recovered Material" },
      { key: "batches", label: "Batches", type: "int" },
      { key: "qty", label: "Quantity (KG)", type: "qty", total: true },
      { key: "share", label: "% of Total Input", type: "pct" },
    ],
    run: async (f) => {
      const batches = await prisma.processingBatch.findMany({ where: { status: "POSTED", date: dRange(f) }, include: { outputs: { include: { item: true } } } });
      const totalInput = batches.reduce((s, b) => s + num(b.inputQty), 0);
      const map = new Map<string, { material: string; batches: Set<string>; qty: number }>();
      for (const b of batches)
        for (const o of b.outputs) {
          const r = map.get(o.itemId) ?? { material: o.item.name, batches: new Set(), qty: 0 };
          r.batches.add(b.id);
          r.qty = round3(r.qty + num(o.quantity));
          map.set(o.itemId, r);
        }
      const rejected = batches.reduce((s, b) => s + num(b.rejectedQty), 0);
      const loss = batches.reduce((s, b) => s + num(b.lossQty), 0);
      const rows: Row[] = [...map.values()].map((r) => ({ material: r.material, batches: r.batches.size, qty: r.qty, share: totalInput ? round2((r.qty / totalInput) * 100) : 0 }));
      if (rejected) rows.push({ material: "Rejected waste (to disposal)", batches: null, qty: round3(rejected), share: totalInput ? round2((rejected / totalInput) * 100) : 0 });
      if (loss) rows.push({ material: "Process loss (moisture etc.)", batches: null, qty: round3(loss), share: totalInput ? round2((loss / totalInput) * 100) : 0 });
      return rows;
    },
  },
  {
    key: "inventory",
    title: "Inventory / Stock Summary",
    group: "Inventory & Sales",
    description: "Opening, receipts, issues and closing stock per material and location",
    permissions: ["reports.view", "inventory.view"],
    filters: ["date", "q"],
    columns: [
      { key: "material", label: "Material" },
      { key: "type", label: "Type" },
      { key: "location", label: "Location" },
      { key: "opening", label: "Opening", type: "qty", total: true },
      { key: "inward", label: "Inward", type: "qty", total: true },
      { key: "outward", label: "Outward", type: "qty", total: true },
      { key: "closing", label: "Closing", type: "qty", total: true },
      { key: "unit", label: "Unit" },
    ],
    run: async (f) => stockSummary(f.from, f.to),
  },
  {
    key: "recyclable-sales",
    title: "Recyclable Sales",
    group: "Inventory & Sales",
    description: "Material-wise sales to buyers",
    permissions: ["reports.view", "sales.view"],
    filters: ["date", "q"],
    columns: [
      { key: "number", label: "Invoice" },
      { key: "date", label: "Date", type: "date" },
      { key: "buyer", label: "Buyer" },
      { key: "material", label: "Material" },
      { key: "qty", label: "Quantity (KG)", type: "qty", total: true },
      { key: "rate", label: "Rate", type: "money" },
      { key: "taxable", label: "Taxable Value", type: "money", total: true },
      { key: "gst", label: "GST", type: "money", total: true },
      { key: "total", label: "Total", type: "money", total: true },
      { key: "payment", label: "Payment Status" },
    ],
    run: async (f) => {
      const items = await prisma.salesInvoiceItem.findMany({
        where: { salesInvoice: { status: "POSTED", date: dRange(f) } },
        include: { salesInvoice: { include: { buyer: true } }, item: true },
        orderBy: { salesInvoice: { date: "asc" } },
      });
      return items.map((i) => ({
        number: i.salesInvoice.number,
        date: toISODate(i.salesInvoice.date),
        buyer: i.salesInvoice.buyer.name,
        material: i.item.name,
        qty: num(i.quantity),
        rate: num(i.rate),
        taxable: num(i.taxableValue),
        gst: round2(num(i.cgst) + num(i.sgst) + num(i.igst)),
        total: num(i.total),
        payment: i.salesInvoice.paymentStatus,
      }));
    },
  },
  {
    key: "customer-billing",
    title: "Customer Billing",
    group: "Finance",
    description: "Customer invoices raised in the period",
    permissions: ["reports.view", "billing.view"],
    filters: ["date", "customer", "q"],
    columns: [
      { key: "number", label: "Invoice" },
      { key: "date", label: "Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "period", label: "Billing Period" },
      { key: "taxable", label: "Taxable", type: "money", total: true },
      { key: "cgst", label: "CGST", type: "money", total: true },
      { key: "sgst", label: "SGST", type: "money", total: true },
      { key: "igst", label: "IGST", type: "money", total: true },
      { key: "total", label: "Total", type: "money", total: true },
      { key: "received", label: "Received", type: "money", total: true },
      { key: "balance", label: "Balance", type: "money", total: true },
      { key: "status", label: "Status" },
    ],
    run: async (f) =>
      (
        await prisma.customerInvoice.findMany({
          where: { status: "POSTED", date: dRange(f), customerId: f.customerId || undefined },
          include: { customer: true },
          orderBy: { date: "asc" },
        })
      ).map((i) => ({
        number: i.number,
        date: toISODate(i.date),
        customer: i.customer.name,
        period: i.periodFrom ? `${formatDate(i.periodFrom)} - ${formatDate(i.periodTo)}` : "",
        taxable: num(i.subtotal),
        cgst: num(i.cgst),
        sgst: num(i.sgst),
        igst: num(i.igst),
        total: num(i.total),
        received: num(i.amountReceived),
        balance: round2(num(i.total) - num(i.amountReceived)),
        status: i.paymentStatus,
      })),
  },
  {
    key: "customer-outstanding",
    title: "Customer Outstanding",
    group: "Finance",
    description: "Invoiced, received and balance per customer (as on the 'To' date)",
    permissions: ["reports.view", "receipts.view"],
    filters: ["date", "customer", "q"],
    columns: [
      { key: "customer", label: "Customer" },
      { key: "invoices", label: "Open Invoices", type: "int", total: true },
      { key: "invoiced", label: "Invoiced", type: "money", total: true },
      { key: "received", label: "Received", type: "money", total: true },
      { key: "balance", label: "Balance", type: "money", total: true },
      { key: "overdue", label: "Overdue", type: "money", total: true },
      { key: "advance", label: "Unallocated Advance", type: "money", total: true },
    ],
    run: async (f) => outstandingByCustomer(f.to, f.customerId),
  },
  {
    key: "ageing",
    title: "Receivables Ageing",
    group: "Finance",
    description: "Open customer invoices by days past due",
    permissions: ["reports.view", "receipts.view"],
    filters: ["date", "customer", "q"],
    columns: [
      { key: "invoice", label: "Invoice" },
      { key: "customer", label: "Customer" },
      { key: "date", label: "Date", type: "date" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "amount", label: "Amount", type: "money", total: true },
      { key: "received", label: "Received", type: "money", total: true },
      { key: "balance", label: "Balance", type: "money", total: true },
      { key: "age", label: "Days Overdue", type: "int" },
      { key: "current", label: "Current", type: "money", total: true },
      { key: "b30", label: "1-30", type: "money", total: true },
      { key: "b60", label: "31-60", type: "money", total: true },
      { key: "b90", label: "61-90", type: "money", total: true },
      { key: "b90p", label: "> 90", type: "money", total: true },
    ],
    run: async (f) => ageingRows(f.to, f.customerId),
  },
  {
    key: "purchase",
    title: "Purchase Register",
    group: "Finance",
    description: "Supplier purchases with GST",
    permissions: ["reports.view", "purchases.view"],
    filters: ["date", "q"],
    columns: [
      { key: "number", label: "Purchase No" },
      { key: "date", label: "Date", type: "date" },
      { key: "supplier", label: "Supplier" },
      { key: "bill", label: "Bill No" },
      { key: "taxable", label: "Taxable", type: "money", total: true },
      { key: "gst", label: "GST", type: "money", total: true },
      { key: "total", label: "Total", type: "money", total: true },
      { key: "paid", label: "Paid", type: "money", total: true },
      { key: "status", label: "Payment Status" },
    ],
    run: async (f) =>
      (await prisma.purchase.findMany({ where: { status: "POSTED", date: dRange(f) }, include: { supplier: true }, orderBy: { date: "asc" } })).map((p) => ({
        number: p.number,
        date: toISODate(p.date),
        supplier: p.supplier.name,
        bill: p.billNumber ?? "",
        taxable: num(p.subtotal),
        gst: round2(num(p.cgst) + num(p.sgst) + num(p.igst)),
        total: num(p.total),
        paid: num(p.amountPaid),
        status: p.paymentStatus,
      })),
  },
  {
    key: "expenses",
    title: "Expense Register",
    group: "Finance",
    description: "Operating expenses by category",
    permissions: ["reports.view", "expenses.view"],
    filters: ["date", "vehicle", "q"],
    columns: [
      { key: "number", label: "Expense No" },
      { key: "date", label: "Date", type: "date" },
      { key: "category", label: "Category" },
      { key: "supplier", label: "Supplier" },
      { key: "vehicle", label: "Vehicle" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount", type: "money", total: true },
      { key: "gst", label: "GST", type: "money", total: true },
      { key: "total", label: "Total", type: "money", total: true },
      { key: "mode", label: "Payment Mode" },
    ],
    run: async (f) =>
      (
        await prisma.expense.findMany({
          where: { status: "POSTED", date: dRange(f), vehicleId: f.vehicleId || undefined },
          include: { category: true, supplier: true, vehicle: true },
          orderBy: { date: "asc" },
        })
      ).map((e) => ({
        number: e.number,
        date: toISODate(e.date),
        category: e.category.name,
        supplier: e.supplier?.name ?? "",
        vehicle: e.vehicle?.number ?? "",
        description: e.description ?? "",
        amount: num(e.amount),
        gst: round2(num(e.cgst) + num(e.sgst) + num(e.igst)),
        total: num(e.total),
        mode: e.paymentMode,
      })),
  },
  {
    key: "fuel",
    title: "Fuel Consumption",
    group: "Operations",
    description: "Fuel filled per vehicle with cost",
    permissions: ["reports.view", "vehicles.view"],
    filters: ["date", "vehicle", "driver", "q"],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "vehicle", label: "Vehicle" },
      { key: "driver", label: "Driver" },
      { key: "litres", label: "Litres", type: "qty", total: true },
      { key: "rate", label: "Rate / L", type: "money" },
      { key: "amount", label: "Amount", type: "money", total: true },
      { key: "odometer", label: "Odometer", type: "int" },
      { key: "station", label: "Fuel Station" },
    ],
    run: async (f) =>
      (
        await prisma.vehicleFuel.findMany({
          where: { date: dRange(f), vehicleId: f.vehicleId || undefined, driverId: f.driverId || undefined, expense: { status: "POSTED" } },
          include: { vehicle: true, driver: true },
          orderBy: { date: "asc" },
        })
      ).map((x) => ({
        date: toISODate(x.date),
        vehicle: x.vehicle.number,
        driver: x.driver?.name ?? "",
        litres: num(x.litres),
        rate: num(x.ratePerLitre),
        amount: num(x.amount),
        odometer: x.odometer,
        station: x.fuelStation ?? "",
      })),
  },
  {
    key: "vehicle-maintenance",
    title: "Vehicle Maintenance",
    group: "Operations",
    description: "Service and repair history per vehicle",
    permissions: ["reports.view", "vehicles.view"],
    filters: ["date", "vehicle", "q"],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "vehicle", label: "Vehicle" },
      { key: "type", label: "Type" },
      { key: "description", label: "Description" },
      { key: "vendor", label: "Vendor" },
      { key: "amount", label: "Amount", type: "money", total: true },
      { key: "next", label: "Next Service", type: "date" },
    ],
    run: async (f) =>
      (
        await prisma.vehicleMaintenance.findMany({
          where: { date: dRange(f), vehicleId: f.vehicleId || undefined, expense: { status: "POSTED" } },
          include: { vehicle: true, supplier: true },
          orderBy: { date: "asc" },
        })
      ).map((m) => ({
        date: toISODate(m.date),
        vehicle: m.vehicle.number,
        type: m.maintenanceType,
        description: m.description,
        vendor: m.supplier?.name ?? "",
        amount: num(m.amount),
        next: m.nextServiceDate ? toISODate(m.nextServiceDate) : "",
      })),
  },
  {
    key: "revenue",
    title: "Revenue",
    group: "Finance",
    description: "Monthly service billing and recyclable sales revenue (taxable value)",
    permissions: ["reports.view", "reports.financial"],
    filters: ["date"],
    columns: [
      { key: "month", label: "Month" },
      { key: "service", label: "Service Billing", type: "money", total: true },
      { key: "sales", label: "Recyclable Sales", type: "money", total: true },
      { key: "total", label: "Total Revenue", type: "money", total: true },
    ],
    run: async (f) => (await monthlyPnl(f)).map(({ month, service, sales, revenue }) => ({ month, service, sales, total: revenue })),
  },
  {
    key: "profitability",
    title: "Profitability",
    group: "Finance",
    description: "Monthly revenue against purchases and operating expenses (taxable values, excl. GST)",
    permissions: ["reports.view", "reports.financial"],
    filters: ["date"],
    columns: [
      { key: "month", label: "Month" },
      { key: "revenue", label: "Revenue", type: "money", total: true },
      { key: "purchases", label: "Purchases", type: "money", total: true },
      { key: "expenses", label: "Operating Expenses", type: "money", total: true },
      { key: "profit", label: "Estimated Profit", type: "money", total: true },
      { key: "margin", label: "Margin %", type: "pct" },
    ],
    run: async (f) => monthlyPnl(f),
  },
  {
    key: "gst",
    title: "GST Summary",
    group: "Finance",
    description: "Output GST (sales) and input GST (purchases/expenses) by rate",
    permissions: ["reports.view", "gst.view"],
    filters: ["date"],
    columns: [
      { key: "type", label: "Type" },
      { key: "source", label: "Source" },
      { key: "rate", label: "GST Rate %", type: "pct" },
      { key: "taxable", label: "Taxable Value", type: "money", total: true },
      { key: "cgst", label: "CGST", type: "money", total: true },
      { key: "sgst", label: "SGST", type: "money", total: true },
      { key: "igst", label: "IGST", type: "money", total: true },
      { key: "tax", label: "Total Tax", type: "money", total: true },
    ],
    run: async (f) => gstSummary(f),
  },
  {
    key: "user-activity",
    title: "User Activity",
    group: "Administration",
    description: "Logins and changes made by each user",
    permissions: ["reports.view", "audit.view"],
    filters: ["date", "q"],
    columns: [
      { key: "user", label: "User" },
      { key: "logins", label: "Logins", type: "int", total: true },
      { key: "failed", label: "Failed Logins", type: "int", total: true },
      { key: "creates", label: "Created", type: "int", total: true },
      { key: "updates", label: "Updated", type: "int", total: true },
      { key: "cancels", label: "Cancelled / Reversed", type: "int", total: true },
      { key: "last", label: "Last Activity", type: "datetime" },
    ],
    run: async (f) => {
      const logs = await prisma.auditLog.groupBy({
        by: ["username", "action"],
        where: { createdAt: tRange(f) },
        _count: true,
        _max: { createdAt: true },
      });
      const map = new Map<string, Row>();
      for (const l of logs) {
        const u = l.username ?? "(system)";
        const r = map.get(u) ?? { user: u, logins: 0, failed: 0, creates: 0, updates: 0, cancels: 0, last: null };
        const c = l._count;
        if (l.action === "LOGIN") r.logins = (r.logins as number) + c;
        else if (l.action === "LOGIN_FAILED") r.failed = (r.failed as number) + c;
        else if (l.action === "CREATE") r.creates = (r.creates as number) + c;
        else if (["CANCEL", "REVERSE", "DEACTIVATE"].includes(l.action)) r.cancels = (r.cancels as number) + c;
        else r.updates = (r.updates as number) + c;
        const last = l._max.createdAt?.toISOString() ?? null;
        if (last && (!r.last || last > (r.last as string))) r.last = last;
        map.set(u, r);
      }
      return [...map.values()];
    },
  },
  {
    key: "audit-trail",
    title: "Audit Trail",
    group: "Administration",
    description: "Detailed log of important changes",
    permissions: ["reports.view", "audit.view"],
    filters: ["date", "q"],
    columns: [
      { key: "time", label: "Date / Time", type: "datetime" },
      { key: "user", label: "User" },
      { key: "action", label: "Action" },
      { key: "module", label: "Module" },
      { key: "record", label: "Record" },
      { key: "changes", label: "Changes" },
      { key: "ip", label: "IP" },
    ],
    run: async (f) =>
      (await prisma.auditLog.findMany({ where: { createdAt: tRange(f) }, orderBy: { createdAt: "desc" }, take: 5000 })).map((a) => ({
        time: a.createdAt.toISOString(),
        user: a.username ?? "",
        action: a.action,
        module: a.module,
        record: a.recordLabel ?? a.recordId ?? "",
        changes: a.newValues ? JSON.stringify(a.newValues).slice(0, 300) : "",
        ip: a.ipAddress ?? "",
      })),
  },
];

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key);
}

export function canRun(report: ReportDef, permissions: string[]) {
  return report.permissions.every((p) => permissions.includes(p));
}

/** Run a report and apply the free-text search across all text columns. */
export async function runReport(report: ReportDef, f: ReportFilters) {
  let rows = await report.run(f);
  if (f.q) {
    const q = f.q.toLowerCase();
    const textCols = report.columns.filter((c) => !c.type || c.type === "text").map((c) => c.key);
    rows = rows.filter((r) => textCols.some((k) => String(r[k] ?? "").toLowerCase().includes(q)));
  }
  const totals: Row = {};
  for (const c of report.columns) {
    if (c.total) totals[c.key] = round3(rows.reduce((s, r) => s + num(r[c.key] as number), 0));
  }
  return { rows, totals };
}

// --------------------------- shared calculations ---------------------------

export async function stockSummary(fromISO: string, toISO: string) {
  const from = dateOnly(fromISO);
  const toEnd = addDays(dateOnly(toISO), 1);
  const [items, locations] = await Promise.all([prisma.inventoryItem.findMany({ where: { active: true } }), prisma.location.findMany()]);
  const before = await prisma.inventoryTransaction.groupBy({ by: ["itemId", "locationId"], where: { date: { lt: from } }, _sum: { quantity: true } });
  const during = await prisma.inventoryTransaction.findMany({ where: { date: { gte: from, lt: toEnd } }, select: { itemId: true, locationId: true, quantity: true } });
  const key = (i: string, l: string) => `${i}|${l}`;
  const map = new Map<string, { opening: number; inward: number; outward: number }>();
  for (const b of before) map.set(key(b.itemId, b.locationId), { opening: num(b._sum.quantity), inward: 0, outward: 0 });
  for (const t of during) {
    const k = key(t.itemId, t.locationId);
    const r = map.get(k) ?? { opening: 0, inward: 0, outward: 0 };
    const q = num(t.quantity);
    if (q >= 0) r.inward += q;
    else r.outward += -q;
    map.set(k, r);
  }
  const itemById = new Map(items.map((i) => [i.id, i]));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const rows: Row[] = [];
  for (const [k, r] of map) {
    const [itemId, locId] = k.split("|");
    const it = itemById.get(itemId);
    if (!it) continue;
    rows.push({
      material: it.name,
      type: it.itemType,
      location: locById.get(locId)?.name ?? "",
      opening: round3(r.opening),
      inward: round3(r.inward),
      outward: round3(r.outward),
      closing: round3(r.opening + r.inward - r.outward),
      unit: it.unit,
    });
  }
  return rows.sort((a, b) => String(a.material).localeCompare(String(b.material)));
}

export function ageBucket(daysOverdue: number): "current" | "b30" | "b60" | "b90" | "b90p" {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "b30";
  if (daysOverdue <= 60) return "b60";
  if (daysOverdue <= 90) return "b90";
  return "b90p";
}

export async function ageingRows(asOfISO: string, customerId?: string) {
  const asOf = dateOnly(asOfISO);
  const invoices = await prisma.customerInvoice.findMany({
    where: { status: "POSTED", paymentStatus: { not: "PAID" }, date: { lte: asOf }, customerId: customerId || undefined },
    include: { customer: true },
    orderBy: [{ customer: { name: "asc" } }, { date: "asc" }],
  });
  return invoices.map((i) => {
    const balance = round2(num(i.total) - num(i.amountReceived));
    const age = daysBetween(i.dueDate, asOf);
    const bucket = ageBucket(age);
    return {
      invoice: i.number,
      customer: i.customer.name,
      date: toISODate(i.date),
      dueDate: toISODate(i.dueDate),
      amount: num(i.total),
      received: num(i.amountReceived),
      balance,
      age: Math.max(age, 0),
      current: bucket === "current" ? balance : 0,
      b30: bucket === "b30" ? balance : 0,
      b60: bucket === "b60" ? balance : 0,
      b90: bucket === "b90" ? balance : 0,
      b90p: bucket === "b90p" ? balance : 0,
    } as Row;
  });
}

export async function outstandingByCustomer(asOfISO: string, customerId?: string) {
  const asOf = dateOnly(asOfISO);
  const invoices = await prisma.customerInvoice.findMany({
    where: { status: "POSTED", paymentStatus: { not: "PAID" }, date: { lte: asOf }, customerId: customerId || undefined },
    include: { customer: true },
  });
  const receipts = await prisma.receipt.findMany({
    where: { status: "POSTED", partyType: "CUSTOMER", customerId: customerId || undefined },
  });
  const map = new Map<string, Row>();
  for (const i of invoices) {
    const r = map.get(i.customerId) ?? { customer: i.customer.name, invoices: 0, invoiced: 0, received: 0, balance: 0, overdue: 0, advance: 0 };
    const bal = round2(num(i.total) - num(i.amountReceived));
    r.invoices = (r.invoices as number) + 1;
    r.invoiced = round2((r.invoiced as number) + num(i.total));
    r.received = round2((r.received as number) + num(i.amountReceived));
    r.balance = round2((r.balance as number) + bal);
    if (i.dueDate < asOf) r.overdue = round2((r.overdue as number) + bal);
    map.set(i.customerId, r);
  }
  const custNames = new Map((await prisma.customer.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  for (const rc of receipts) {
    const adv = round2(num(rc.amount) - num(rc.allocatedAmount));
    if (adv <= 0 || !rc.customerId) continue;
    const r = map.get(rc.customerId) ?? { customer: custNames.get(rc.customerId) ?? "", invoices: 0, invoiced: 0, received: 0, balance: 0, overdue: 0, advance: 0 };
    r.advance = round2((r.advance as number) + adv);
    map.set(rc.customerId, r);
  }
  return [...map.values()].sort((a, b) => (b.balance as number) - (a.balance as number));
}

function monthKey(d: Date) {
  return d.toISOString().slice(0, 7);
}

export async function monthlyPnl(f: ReportFilters) {
  const range = dRange(f);
  const [inv, sales, pur, exp] = await Promise.all([
    prisma.customerInvoice.findMany({ where: { status: "POSTED", date: range }, select: { date: true, subtotal: true } }),
    prisma.salesInvoice.findMany({ where: { status: "POSTED", date: range }, select: { date: true, subtotal: true } }),
    prisma.purchase.findMany({ where: { status: "POSTED", date: range }, select: { date: true, subtotal: true } }),
    prisma.expense.findMany({ where: { status: "POSTED", date: range }, select: { date: true, amount: true } }),
  ]);
  const map = new Map<string, { service: number; sales: number; purchases: number; expenses: number }>();
  const g = (k: string) => map.get(k) ?? map.set(k, { service: 0, sales: 0, purchases: 0, expenses: 0 }).get(k)!;
  for (const x of inv) g(monthKey(x.date)).service += num(x.subtotal);
  for (const x of sales) g(monthKey(x.date)).sales += num(x.subtotal);
  for (const x of pur) g(monthKey(x.date)).purchases += num(x.subtotal);
  for (const x of exp) g(monthKey(x.date)).expenses += num(x.amount);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, r]) => {
      const revenue = round2(r.service + r.sales);
      const profit = round2(revenue - r.purchases - r.expenses);
      return {
        month,
        service: round2(r.service),
        sales: round2(r.sales),
        revenue,
        purchases: round2(r.purchases),
        expenses: round2(r.expenses),
        profit,
        margin: revenue ? round2((profit / revenue) * 100) : 0,
      };
    });
}

export async function gstSummary(f: ReportFilters) {
  const range = dRange(f);
  const rows: Row[] = [];
  const add = (type: string, source: string, list: { gstRate: unknown; taxableValue: unknown; cgst: unknown; sgst: unknown; igst: unknown }[]) => {
    const m = new Map<number, Row>();
    for (const l of list) {
      const rate = num(l.gstRate as number);
      const r = m.get(rate) ?? { type, source, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
      r.taxable = round2((r.taxable as number) + num(l.taxableValue as number));
      r.cgst = round2((r.cgst as number) + num(l.cgst as number));
      r.sgst = round2((r.sgst as number) + num(l.sgst as number));
      r.igst = round2((r.igst as number) + num(l.igst as number));
      r.tax = round2((r.cgst as number) + (r.sgst as number) + (r.igst as number));
      m.set(rate, r);
    }
    rows.push(...[...m.values()].sort((a, b) => (a.rate as number) - (b.rate as number)));
  };
  add("Output", "Customer invoices", await prisma.customerInvoiceItem.findMany({ where: { invoice: { status: "POSTED", date: range } } }));
  add("Output", "Recyclable sales", await prisma.salesInvoiceItem.findMany({ where: { salesInvoice: { status: "POSTED", date: range } } }));
  add("Input", "Purchases", await prisma.purchaseItem.findMany({ where: { purchase: { status: "POSTED", date: range } } }));
  add(
    "Input",
    "Expenses",
    (await prisma.expense.findMany({ where: { status: "POSTED", date: range } })).map((e) => ({ gstRate: e.gstRate, taxableValue: e.amount, cgst: e.cgst, sgst: e.sgst, igst: e.igst })),
  );
  return rows;
}
