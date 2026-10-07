import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <p className="text-5xl font-bold text-navy-200">404</p>
      <h2 className="mt-2 text-lg font-semibold text-navy-800">Record not found</h2>
      <p className="mt-1 text-sm text-slate-500">It may have been moved or you may have followed an old link.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Back to dashboard</Link>
    </div>
  );
}
