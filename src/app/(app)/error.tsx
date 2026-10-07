"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-red-100 bg-white p-8 text-center shadow-sm">
      <AlertTriangle className="mx-auto size-10 text-amber-500" />
      <h2 className="mt-3 text-lg font-semibold text-navy-800">This page could not be loaded</h2>
      <p className="mt-1 text-sm text-slate-500">
        Something went wrong while loading the data. Please try again. If the problem continues, contact your administrator
        {error.digest ? ` and quote reference ${error.digest}` : ""}.
      </p>
      <Button className="mt-5" onClick={reset}><RotateCcw /> Try again</Button>
    </div>
  );
}
