"use server";

import { act } from "@/server/action";
import { installLicense } from "@/server/license";
import { setSetting, updateCompany, updateGstSettings, updateSequence } from "@/server/services/settings";

export async function companyAction(values: Record<string, unknown>) {
  return act((ctx) => updateCompany(ctx, values), ["/settings"]);
}
export async function gstSettingsAction(values: Record<string, unknown>) {
  return act((ctx) => updateGstSettings(ctx, values), ["/gst"]);
}
export async function sequenceAction(values: Record<string, unknown>) {
  return act((ctx) => updateSequence(ctx, values), ["/settings"]);
}
export async function settingAction(key: string, value: string) {
  return act((ctx) => setSetting(ctx, key, value), ["/settings"]);
}
export async function licenseAction(key: string) {
  return act((ctx) => installLicense(ctx, key), ["/settings", "/dashboard"], { allowUnlicensed: true });
}
