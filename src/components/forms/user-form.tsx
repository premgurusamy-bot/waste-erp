"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createUserAction, rolePermissionsAction, updateUserAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { ACTION_LABELS, MODULES } from "@/lib/permissions";
import { useDialogClose } from "./confirm-action";

type Role = { id: string; code: string; name: string; description: string | null; permissions: string[] };

export function PermissionMatrix({ value, onChange, inherited = [], disabled }: { value: string[]; onChange: (v: string[]) => void; inherited?: string[]; disabled?: boolean }) {
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {MODULES.map((m) => (
            <tr key={m.key}>
              <td className="px-3 py-1.5 font-medium text-slate-700">{m.label}</td>
              <td className="px-3 py-1.5">
                <div className="flex flex-wrap gap-3">
                  {m.actions.map((a) => {
                    const code = `${m.key}.${a}`;
                    const fromRole = inherited.includes(code);
                    return (
                      <label key={code} className="flex items-center gap-1.5 text-xs text-slate-600" title={fromRole ? "Granted by role" : undefined}>
                        <input type="checkbox" className="size-3.5 accent-brand-600" disabled={disabled || fromRole} checked={fromRole || value.includes(code)} onChange={() => toggle(code)} />
                        {ACTION_LABELS[a]}
                      </label>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UserForm({ roles, user }: { roles: Role[]; user?: { id: string; username: string; name: string; email: string | null; mobile: string | null; status: string; roleIds: string[]; permissionCodes: string[] } }) {
  const router = useRouter();
  const close = useDialogClose();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ username: user?.username ?? "", name: user?.name ?? "", email: user?.email ?? "", mobile: user?.mobile ?? "", password: "", status: user?.status ?? "ACTIVE" });
  const [roleIds, setRoleIds] = useState<string[]>(user?.roleIds ?? []);
  const [perms, setPerms] = useState<string[]>(user?.permissionCodes ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inherited = roles.filter((r) => roleIds.includes(r.id)).flatMap((r) => r.permissions);
  const submit = () =>
    start(async () => {
      const payload = { ...v, roleIds, permissionCodes: perms.filter((p) => !inherited.includes(p)) };
      const r = user ? await updateUserAction({ ...payload, id: user.id }) : await createUserAction(payload);
      if (!r.ok) {
        toast.error(r.error);
        setErrors({ ...(r.fieldErrors ?? {}), _: r.error });
        return;
      }
      toast.success(user ? "User updated" : "User created. They must change the password at first login.");
      close?.();
      router.refresh();
    });
  const field = (k: keyof typeof v, label: string, type = "text", req = false, disabled = false) => (
    <div>
      <Label htmlFor={`u-${k}`} required={req}>{label}</Label>
      <Input id={`u-${k}`} type={type} value={v[k]} disabled={disabled} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={!!errors[k]} autoComplete={type === "password" ? "new-password" : "off"} />
      <FieldError message={errors[k]} />
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("username", "Username", "text", true, !!user)}
        {field("name", "Full Name", "text", true)}
        {field("email", "Email", "email")}
        {field("mobile", "Mobile", "tel")}
        {!user && field("password", "Temporary Password", "password", true)}
        {user && (
          <div>
            <Label htmlFor="u-status">Status</Label>
            <Select id="u-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          </div>
        )}
      </div>
      <div>
        <Label required>Roles</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {roles.map((r) => (
            <label key={r.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={roleIds.includes(r.id)} onChange={() => setRoleIds(roleIds.includes(r.id) ? roleIds.filter((x) => x !== r.id) : [...roleIds, r.id])} />
              <span><span className="block font-medium">{r.name}</span><span className="block text-xs text-slate-500">{r.description}</span></span>
            </label>
          ))}
        </div>
        <FieldError message={errors.roleIds} />
      </div>
      <div>
        <Label>Additional permissions (on top of roles)</Label>
        <PermissionMatrix value={perms} onChange={setPerms} inherited={inherited} />
      </div>
      {errors._ && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors._}</p>}
      <Button onClick={submit} disabled={pending}>{pending && <Loader2 className="animate-spin" />} {user ? "Save User" : "Create User"}</Button>
    </div>
  );
}

export function RolePermissionsForm({ role }: { role: Role }) {
  const [perms, setPerms] = useState(role.permissions);
  const [pending, start] = useTransition();
  const router = useRouter();
  const close = useDialogClose();
  const locked = role.code === "ADMIN";
  return (
    <div className="space-y-4">
      <PermissionMatrix value={perms} onChange={setPerms} disabled={locked} />
      {locked ? (
        <p className="text-sm text-slate-500">The Administrator role always has every permission.</p>
      ) : (
        <Button disabled={pending} onClick={() => start(async () => { const r = await rolePermissionsAction(role.id, perms); if (!r.ok) return void toast.error(r.error); toast.success("Role permissions saved"); close?.(); router.refresh(); })}>
          {pending && <Loader2 className="animate-spin" />} Save Permissions
        </Button>
      )}
    </div>
  );
}

export function ResetPasswordForm({ userId, action }: { userId: string; action: (id: string, pw: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const close = useDialogClose();
  return (
    <div className="space-y-3">
      <div><Label htmlFor="newpw" required>New temporary password</Label><Input id="newpw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
      <p className="text-xs text-slate-500">At least 8 characters with a letter and a number. The user is signed out everywhere and must change it at next login.</p>
      <FieldError message={err} />
      <Button disabled={pending} onClick={() => start(async () => { const r = await action(userId, pw); if (!r.ok) return void setErr(r.error); toast.success("Password reset"); close?.(); })}>
        {pending && <Loader2 className="animate-spin" />} Reset Password
      </Button>
    </div>
  );
}
