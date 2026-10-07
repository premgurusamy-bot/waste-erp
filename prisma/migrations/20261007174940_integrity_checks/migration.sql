-- Database-level integrity checks (defence in depth; the application validates first)

ALTER TABLE "weighments"
  ADD CONSTRAINT "weighments_gross_positive" CHECK ("grossWeight" > 0),
  ADD CONSTRAINT "weighments_tare_valid" CHECK ("tareWeight" IS NULL OR ("tareWeight" >= 0 AND "tareWeight" < "grossWeight")),
  ADD CONSTRAINT "weighments_net_nonnegative" CHECK ("netWeight" IS NULL OR "netWeight" >= 0);

-- Only one open (gate-in) weighment per vehicle at a time
CREATE UNIQUE INDEX "weighments_one_open_per_vehicle" ON "weighments" ("vehicleId") WHERE "status" = 'GATE_IN';
-- Weighbridge slip numbers cannot repeat among non-cancelled weighments
CREATE UNIQUE INDEX "weighments_slip_unique_active" ON "weighments" ("slipNumber") WHERE "slipNumber" IS NOT NULL AND "status" <> 'CANCELLED';

ALTER TABLE "processing_batches"
  ADD CONSTRAINT "processing_balanced" CHECK ("inputQty" = "outputQty" + "rejectedQty" + "lossQty"),
  ADD CONSTRAINT "processing_nonnegative" CHECK ("inputQty" > 0 AND "outputQty" >= 0 AND "rejectedQty" >= 0 AND "lossQty" >= 0);

ALTER TABLE "processing_inputs" ADD CONSTRAINT "processing_inputs_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "processing_outputs" ADD CONSTRAINT "processing_outputs_qty_positive" CHECK ("quantity" > 0);

ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_items_qty_positive" CHECK ("quantity" > 0 AND "rate" >= 0);
ALTER TABLE "customer_invoice_items" ADD CONSTRAINT "customer_items_qty_positive" CHECK ("quantity" > 0 AND "rate" >= 0);
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_qty_positive" CHECK ("quantity" > 0 AND "rate" >= 0);

ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_received_valid" CHECK ("amountReceived" >= 0 AND "amountReceived" <= "total");
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_received_valid" CHECK ("amountReceived" >= 0 AND "amountReceived" <= "total");
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_paid_valid" CHECK ("amountPaid" >= 0 AND "amountPaid" <= "total");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_valid" CHECK ("amount" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_valid" CHECK ("amount" > 0 AND "allocatedAmount" >= 0 AND "allocatedAmount" <= "amount");
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_party_valid" CHECK (("partyType" = 'CUSTOMER' AND "customerId" IS NOT NULL) OR ("partyType" = 'BUYER' AND "buyerId" IS NOT NULL));
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_alloc_valid" CHECK ("amount" > 0 AND (("customerInvoiceId" IS NOT NULL) <> ("salesInvoiceId" IS NOT NULL)));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_alloc_valid" CHECK ("amount" > 0 AND (("purchaseId" IS NOT NULL) <> ("expenseId" IS NOT NULL)));

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0));

ALTER TABLE "customer_rates" ADD CONSTRAINT "customer_rates_valid" CHECK ("rate" >= 0 AND ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"));
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dates_valid" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "gst_rates" ADD CONSTRAINT "gst_rates_range" CHECK ("rate" >= 0 AND "rate" <= 100);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_capacity_positive" CHECK ("capacityKg" > 0);
