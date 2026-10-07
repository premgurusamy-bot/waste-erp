import { StatusBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { expiryState } from "@/server/services/notifications";

export function ExpiryCell({ date }: { date: Date | null }) {
  const st = expiryState(date);
  if (st === "NOT_SET") return <span className="text-slate-400">Not set</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="text-xs">{formatDate(date)}</span>
      <StatusBadge status={st} label={st === "ACTIVE" ? "Active" : st === "EXPIRED" ? "Expired" : "Expiring soon"} />
    </span>
  );
}

export function worstExpiry(dates: (Date | null)[]) {
  const states = dates.map((d) => expiryState(d));
  if (states.includes("EXPIRED")) return "EXPIRED";
  if (states.includes("EXPIRING_SOON")) return "EXPIRING_SOON";
  return "ACTIVE";
}
