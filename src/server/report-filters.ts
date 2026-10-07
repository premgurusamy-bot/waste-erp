import { todayISO } from "@/lib/utils";
import type { ReportFilters } from "./reports";

export function parseReportFilters(get: (k: string) => string | undefined): ReportFilters {
  const to = get("to") || todayISO();
  const from = get("from") || `${to.slice(0, 7)}-01`;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from: iso.test(from) ? from : `${to.slice(0, 7)}-01`,
    to: iso.test(to) ? to : todayISO(),
    customerId: get("customerId") || undefined,
    wasteTypeId: get("wasteTypeId") || undefined,
    vehicleId: get("vehicleId") || undefined,
    driverId: get("driverId") || undefined,
    q: get("q")?.slice(0, 100) || undefined,
  };
}
