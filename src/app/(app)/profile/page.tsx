import { changePasswordAction } from "@/app/actions/auth";
import { EntityForm } from "@/components/forms/entity-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DetailGrid, PageHeader, Section } from "@/components/ui/page";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { requireUser } from "@/server/auth/current-user";

export const metadata = { title: "My Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ force?: string }> }) {
  const me = await requireUser();
  const { force } = await searchParams;
  const [u, recent] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: me.id } }),
    prisma.auditLog.findMany({ where: { userId: me.id, action: { in: ["LOGIN", "LOGIN_FAILED", "PASSWORD_CHANGE"] } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  return (
    <>
      <PageHeader title="My Profile" description={me.roleNames.join(", ")} />
      {(force || me.mustChangePassword) && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You are using a temporary password. Please set a new password to continue.</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card><CardContent>
          <DetailGrid cols={2} items={[
            { label: "Username", value: u.username },
            { label: "Name", value: u.name },
            { label: "Email", value: u.email },
            { label: "Mobile", value: u.mobile },
            { label: "Roles", value: <div className="flex gap-1">{me.roleNames.map((r) => <Badge key={r} tone="blue">{r}</Badge>)}</div> },
            { label: "Last Login", value: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : null },
          ]} />
        </CardContent></Card>
        <Section title="Change Password">
          <CardContent>
            <EntityForm
              schemaKey="changePassword"
              cols={1}
              fields={[
                { name: "currentPassword", label: "Current Password", type: "password", required: true },
                { name: "newPassword", label: "New Password", type: "password", required: true, help: "At least 8 characters, with a letter and a number" },
                { name: "confirmPassword", label: "Confirm New Password", type: "password", required: true },
              ]}
              action={changePasswordAction}
              submitLabel="Change Password"
              successMessage="Password changed. Other sessions have been signed out."
              redirectTo="/dashboard"
            />
          </CardContent>
        </Section>
        <Section title="Recent Sign-in Activity" className="xl:col-span-2">
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.map((a) => <li key={a.id} className="flex justify-between px-5 py-2"><span>{a.action.replace("_", " ").toLowerCase()}</span><span className="text-slate-500">{formatDateTime(a.createdAt)} · {a.ipAddress ?? ""}</span></li>)}
          </ul>
        </Section>
      </div>
    </>
  );
}
