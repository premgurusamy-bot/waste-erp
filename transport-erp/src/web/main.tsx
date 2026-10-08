import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AuthProvider, useAuth } from "./auth";
import { ToastProvider } from "./components/ui";
import { Layout, MorePage } from "./components/Layout";
import { LoginPage, SetupPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { TripDetailPage, TripFormPage, TripsPage } from "./pages/Trips";
import { MasterDetailPage, MasterFormPage, MasterListPage } from "./pages/Masters";
import { InvoiceDetailPage, InvoicesPage, NewInvoicePage } from "./pages/Billing";
import { PaymentsPage } from "./pages/Payments";
import { ExpenseDetailPage, ExpenseFormPage, ExpensesPage } from "./pages/Expenses";
import { AlertsPage, DocumentsPage, ProfitPage, ReportsPage, TargetsPage } from "./pages/Analysis";
import { BackupPage } from "./pages/Backup";
import { SettingsPage } from "./pages/Settings";

function Protected() {
  const { me } = useAuth();
  if (!me) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  return <Layout />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<AuthProvider><Protected /></AuthProvider>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/new" element={<TripFormPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/trips/:id/edit" element={<TripFormPage />} />
          <Route path="/masters/:kind" element={<MasterListPage />} />
          <Route path="/masters/:kind/new" element={<MasterFormPage />} />
          <Route path="/masters/:kind/:id" element={<MasterDetailPage />} />
          <Route path="/masters/:kind/:id/edit" element={<MasterFormPage />} />
          <Route path="/billing" element={<InvoicesPage />} />
          <Route path="/billing/new" element={<NewInvoicePage />} />
          <Route path="/billing/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/expenses/new" element={<ExpenseFormPage />} />
          <Route path="/expenses/:id" element={<ExpenseDetailPage />} />
          <Route path="/expenses/:id/edit" element={<ExpenseFormPage />} />
          <Route path="/profit" element={<ProfitPage />} />
          <Route path="/targets" element={<TargetsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
