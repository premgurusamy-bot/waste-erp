"use server";

import { act } from "@/server/action";
import { archiveDocument } from "@/server/services/documents";
import { createUser, resetPassword, updateRolePermissions, updateUser } from "@/server/services/users";

export async function createUserAction(values: Record<string, unknown>) {
  return act((ctx) => createUser(ctx, values), ["/users"]);
}
export async function updateUserAction(values: Record<string, unknown>) {
  return act((ctx) => updateUser(ctx, values), ["/users"]);
}
export async function resetPasswordAction(userId: string, password: string) {
  return act((ctx) => resetPassword(ctx, userId, password).then((u) => ({ id: u.id })), ["/users"]);
}
export async function rolePermissionsAction(roleId: string, codes: string[]) {
  return act((ctx) => updateRolePermissions(ctx, roleId, codes), ["/users"]);
}
export async function archiveDocumentAction(id: string, reason: string) {
  return act((ctx) => archiveDocument(ctx, id, reason).then((d) => ({ id: d.id })), ["/documents"]);
}
