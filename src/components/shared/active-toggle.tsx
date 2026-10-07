import { Power, PowerOff } from "lucide-react";
import { setActiveAction } from "@/app/actions/masters";
import { ConfirmAction } from "@/components/forms/confirm-action";
import type { EntityKey } from "@/server/services/masters";

export function ActiveToggle({ entity, id, active, label }: { entity: EntityKey; id: string; active: boolean; label: string }) {
  return active ? (
    <ConfirmAction
      label="Deactivate"
      icon={<PowerOff />}
      title={`Deactivate ${label}?`}
      description="The record is kept for history but can no longer be used in new transactions."
      action={setActiveAction.bind(null, entity, id, false)}
      successMessage="Deactivated"
    />
  ) : (
    <ConfirmAction
      label="Activate"
      icon={<Power />}
      variant="default"
      title={`Activate ${label}?`}
      action={setActiveAction.bind(null, entity, id, true)}
      successMessage="Activated"
    />
  );
}
