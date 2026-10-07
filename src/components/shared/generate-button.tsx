"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { generateSchedulesAction, startScheduleAction } from "@/app/actions/operations";
import { Button } from "@/components/ui/button";

export function GenerateSchedulesButton({ date }: { date: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await generateSchedulesAction(date);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`${(r.data as any)?.created ?? 0} schedule(s) generated from daily sites`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Wand2 />} Generate daily schedules
    </Button>
  );
}

export function StartButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="navy"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startScheduleAction(id);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Collection started");
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="animate-spin" />} Start
    </Button>
  );
}
