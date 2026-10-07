import { KeyRound, Pencil, Plus, ShieldCheck } from "lucide-react";
import { resetPasswordAction } from "@/app/actions/admin";
import { FormDialog } from "@/components/forms/confirm-action";
import { ResetPasswordForm, RolePermissionsForm, UserForm } from "@/components/forms/user-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LinkTabs, PageHeader } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/list-params";
import { formatDateTime } from "@/lib/utils";
import { requirePermission } from "@/server/auth/current-user";

export const metadata = { title: "Users & Roles" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("users.view");
  const sp = await searchParams;
  const tab = str(sp, "tab") ?? "users";
  const manage = me.permissions.includes("users.manage");
  const [users, rolesRaw] = await Promise.all([
    prisma.user.findMany({ include: { roles: { include: { role: true } }, permissions: { include: { permission: true } } }, orderBy: { username: "asc" } }),
    prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { name: "asc" } }),
  ]);
  const roles = rolesRaw.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, permissions: r.permissions.map((p) => p.permission.code), users: r._count.users }));
  return (
    <>
      <PageHeader
        title="Users & Roles"
        description="Passwords are stored as bcrypt hashes. Disable users instead of deleting them."
        actions={manage && (
          <FormDialog label="New User" icon={<Plus />} title="Create user" variant="default" size="md" wide>
            <UserForm roles={roles} />
          </FormDialog>
        )}
      />
      <LinkTabs base="/users" active={tab} tabs={[{ key: "users", label: "Users", count: users.length }, { key: "roles", label: "Roles & Permissions", count: roles.length }]} />
      {tab === "users" ? (
        <Card>
          <DataTable
            rows={users}
            rowKey={(u) => u.id}
            columns={[
              { key: "u", header: "Username", cell: (u) => <span className="font-mono text-sm">{u.username}</span> },
              { key: "n", header: "Name", cell: (u) => <div><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{[u.email, u.mobile].filter(Boolean).join(" · ")}</div></div> },
              { key: "r", header: "Roles", cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.roleId} tone="blue">{r.role.name}</Badge>)}{u.permissions.length > 0 && <Badge tone="purple">+{u.permissions.length} extra</Badge>}</div> },
              { key: "l", header: "Last Login", cell: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-slate-400">Never</span>) },
              { key: "s", header: "Status", cell: (u) => <div className="flex flex-col items-start gap-0.5"><StatusBadge status={u.status} />{u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="red">Locked</Badge>}{u.mustChangePassword && <Badge tone="amber">Temp password</Badge>}</div> },
              ...(manage
                ? [{
                    key: "a",
                    header: "",
                    cell: (u: (typeof users)[number]) => (
                      <div className="flex justify-end gap-1">
                        <FormDialog label="" icon={<Pencil />} variant="ghost" title={`Edit ${u.username}`} wide>
                          <UserForm roles={roles} user={{ id: u.id, username: u.username, name: u.name, email: u.email, mobile: u.mobile, status: u.status, roleIds: u.roles.map((r) => r.roleId), permissionCodes: u.permissions.map((p) => p.permission.code) }} />
                        </FormDialog>
                        <FormDialog label="" icon={<KeyRound />} variant="ghost" title={`Reset password · ${u.username}`}>
                          <ResetPasswordForm userId={u.id} action={resetPasswordAction} />
                        </FormDialog>
                      </div>
                    ),
                  }]
                : []),
            ]}
          />
        </Card>
      ) : (
        <Card>
          <DataTable
            rows={roles}
            rowKey={(r) => r.id}
            columns={[
              { key: "n", header: "Role", cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
              { key: "u", header: "Users", align: "right", cell: (r) => r.users },
              { key: "p", header: "Permissions", cell: (r) => <span className="text-xs text-slate-600">{r.permissions.length} permissions · {[...new Set(r.permissions.map((p) => p.split(".")[0]))].length} modules</span> },
              ...(manage
                ? [{ key: "a", header: "", cell: (r: (typeof roles)[number]) => (
                    <FormDialog label="Permissions" icon={<ShieldCheck />} title={`${r.name} · permissions`} wide>
                      <RolePermissionsForm role={r} />
                    </FormDialog>
                  ) }]
                : []),
            ]}
          />
        </Card>
      )}
    </>
  );
}
