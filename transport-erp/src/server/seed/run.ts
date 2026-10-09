import { prisma } from "../db.js";
import { seedBase, seedDemo } from "./seed.js";
import { refreshNotifications } from "../services/alerts.js";

const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin@123";
if (!process.env.SEED_ADMIN_PASSWORD) console.warn("SEED_ADMIN_PASSWORD not set: the admin password is Admin@123. Change it after signing in.");
await seedBase({ adminPassword });
if (process.env.SEED_DEMO !== "false") {
  const r = await seedDemo();
  console.log(r.skipped ? "Demo data skipped (trips already exist)." : `Demo data created (${r.trips} trips).`);
}
await refreshNotifications();
const counts = {
  customers: await prisma.customer.count(), transporters: await prisma.transporter.count(), vehicles: await prisma.vehicle.count(), drivers: await prisma.driver.count(),
  trips: await prisma.trip.count(), expenses: await prisma.expense.count(), invoices: await prisma.customerInvoice.count(), receipts: await prisma.customerReceipt.count(),
  settlements: await prisma.transporterSettlement.count(), transporterPayments: await prisma.transporterPayment.count(),
};
console.log(counts);
await prisma.$disconnect();
