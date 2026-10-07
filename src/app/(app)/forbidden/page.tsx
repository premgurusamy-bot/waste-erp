import { ShieldX } from "lucide-react";
import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <ShieldX className="mx-auto size-10 text-red-500" />
      <h2 className="mt-3 text-lg font-semibold text-navy-800">Access denied</h2>
      <p className="mt-1 text-sm text-slate-500">Your role does not include access to this page. Ask an administrator if you need it.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Back to dashboard</Link>
    </div>
  );
}
