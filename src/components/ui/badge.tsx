import { cn, titleCase } from "@/lib/utils";

const TONES = {
  green: "bg-brand-50 text-brand-700 ring-brand-600/20",
  blue: "bg-navy-50 text-navy-700 ring-navy-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  grey: "bg-slate-100 text-slate-600 ring-slate-500/20",
  purple: "bg-violet-50 text-violet-700 ring-violet-600/20",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "grey", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: "green", INACTIVE: "grey", DISABLED: "grey",
  PENDING: "amber", SCHEDULED: "blue", ASSIGNED: "purple", IN_PROGRESS: "blue", COMPLETED: "green", CANCELLED: "red",
  PARTIAL: "amber", NOT_COLLECTED: "red", GATE_IN: "amber", POSTED: "green",
  UNPAID: "red", PAID: "green", EXPIRED: "red", EXPIRING_SOON: "amber", NOT_SET: "grey",
  DRAFT: "grey", TERMINATED: "red", SUPERSEDED: "grey", UNDER_MAINTENANCE: "amber",
  LOW: "grey", NORMAL: "blue", HIGH: "amber", URGENT: "red",
  CRITICAL: "red", WARNING: "amber", INFO: "blue",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "grey"}>{label ?? titleCase(status)}</Badge>;
}
