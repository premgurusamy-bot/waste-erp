# User Guide

## Signing in and roles
Open the application and sign in with the username and password from your administrator. A temporary password must be changed on first sign-in (**My profile → Change password**). After 5 wrong passwords the account is locked for 15 minutes.

The left menu only shows what your role allows:

| Role | Typical user | Can do |
|---|---|---|
| Administrator | IT / owner | Everything, including user management, settings, weighment override, negative-stock override |
| Management | Directors | View every module, dashboard, all reports incl. profitability (read-only) |
| Operations | Ops supervisor | Customers & sites, pickups, schedules, collections, vehicles, drivers |
| Weighbridge / Store | Weighbridge operator | Gate-in / gate-out, stock movements |
| Processing | MRF supervisor | Processing batches |
| Sales / Purchase | Commercial team | Recyclable sales, buyers, purchases, suppliers |
| Accounts | Accountant | Billing, receipts, supplier payments, accounts, GST, expenses |

Administrators can grant extra permissions to an individual user (Users & Roles → edit user) or change a role's permissions.

## Everyday flow
1. **Customer** (Customers → New Customer). The code (CUS-00001) is automatic. GSTIN sets the state used for GST.
2. **Site** (Customer profile → Add Site): address, GPS, waste type, frequency, timing.
3. **Contract & rate** (Contracts → New Contract → Add Rate):
   - *Weight based*: rate per KG or per tonne → invoice = weight × rate
   - *Trip based*: rate per trip → invoice = trips × rate
   - *Monthly*: fixed amount per month
   A rate can be limited to a site and/or waste type. To change a price use **Revise** with an effective date — the old version is kept and earlier transactions keep their price.
4. **Pickup request** (Pickup Requests → New). Status: Pending → Assigned → In Progress → Completed (or Cancelled).
5. **Schedule** (Pickup list → Schedule, or Collection Schedule → New Schedule / *Generate daily schedules* for daily sites). Assign vehicle and driver, reschedule, start or cancel from the daily board. *Week calendar* shows the week.
6. **Collection**: drivers use **Field Tasks** on a phone → *Collect* → actual quantity, photo, GPS, status → *Submit*. The office can use Collections → Record Collection.
7. **Weighment** (Weighment → Gate In, or *Gate In* next to a collection): enter gross weight and slip number. When the vehicle leaves, enter the tare weight — **net weight is calculated automatically** and cannot be typed. Net weight is added to “<Waste type> (Unprocessed)” stock. Print the weighbridge slip from the weighment page. Only an administrator can override a net weight, and must give a reason.
8. **Processing** (Waste Processing → New Batch): choose input waste and quantity, recovered outputs, rejected quantity and process loss. The batch cannot be saved unless *Input = Output + Rejected + Loss*. Use *Fill* to put the remainder into loss.
9. **Inventory**: current stock by material and location, and a stock ledger (opening, receipts, recovery, transfers, sales, disposal, adjustments, closing). *Stock Movement* records transfers, disposal of rejected waste and adjustments (reason required).
10. **Recyclable sale** (Recyclable Sales → New Sale): buyer, location, materials, rate. Available stock is shown; a sale larger than stock is refused. Saving creates the tax invoice and reduces stock together.
11. **Customer invoice** (Billing & Invoices → Generate Invoice): choose customer and billing period → *Calculate billable charges* shows weighments/trips/monthly charges with the correct rate versions → add manual lines if needed → *Create Invoice*. Print / download PDF / email. Billed weighments cannot be billed again; cancelling an unpaid invoice releases them.
12. **Receipt** (Receipts → New Receipt): customer or buyer, amount, mode, bank account, reference → *Auto-allocate* to the oldest invoices or type allocations. Unallocated money is kept as an advance and can be allocated later from the receipt page.
13. **Outstanding**: customer-wise balances and ageing (Current, 1–30, 31–60, 61–90, >90 days). The customer profile has a full *Statement* (PDF / Excel).

## Other modules
- **Purchases** and **Supplier Payments**: supplier bills (stock items go into inventory) and payments allocated to bills.
- **Expenses**: categories Fuel, Labour, Vehicle Maintenance, Electricity, Rent, Processing, Transport, Office, Repairs, Other. *Credit* expenses become supplier payables. Fuel and maintenance are recorded from the vehicle page and create the expense automatically.
- **Vehicles**: trips, waste moved, fuel, maintenance, expenses, attributed revenue and profitability per vehicle; document expiry status (RC, insurance, FC, pollution, permit: Active / Expiring soon / Expired).
- **Drivers**: trips, quantity collected, completion rate, licence expiry.
- **Accounts**: every invoice, sale, receipt, purchase, expense and payment is posted automatically. Trial balance, ledgers (cash book, bank book, any account), journals, receivables, payables, chart of accounts, manual journal vouchers.
- **GST**: tax summary (output vs input, net payable), output and input registers, GST rates (admin-configurable), GST settings (default SAC, default rates, round-off).
- **Reports**: 23 reports with date and relevant filters, search, Excel, CSV, PDF and Print.
- **Documents**: all attachments (weighbridge slips, agreements, vehicle/driver documents, bills, photos) with category and link to the record.
- **Notifications** (bell icon): vehicle documents, driver licences, contract expiry, overdue invoices, pending pickups, unusual process loss, low stock.
- **Global search** (top bar): customers, sites, invoices, pickups, weighments, vehicles, drivers, sales, payments, materials.
- **Audit trail**: who did what, when, previous and new values, IP and device.

## Corrections — nothing is deleted
Use **Cancel** (with a reason) on weighments, processing batches, sales, invoices, receipts, payments, purchases and expenses. Cancelling reverses stock and accounting entries. Master records are **deactivated** instead of deleted. Some cancellations are blocked to protect data, e.g. an invoice with payments must have its receipts cancelled first; a processing batch whose output has been sold cannot be cancelled.
