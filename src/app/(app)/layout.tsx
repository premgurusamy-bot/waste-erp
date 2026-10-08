import { prisma } from "@/lib/db";
import { NAVIGATION } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireUser } from "@/server/auth/current-user";
import { getLicenseStatus } from "@/server/license";
import { getNotificationsFor, refreshNotifications } from "@/server/services/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await refreshNotifications().catch((e) => console.error("notification refresh failed", e));
  const [company, notifications, licence] = await Promise.all([prisma.company.findFirst(), getNotificationsFor(user.id, user.permissions), getLicenseStatus()]);
  const licenceNote = licence.state === "active" ? null : licence.state === "trial" || licence.state === "expiring" ? "amber" : "red";
  const nav = NAVIGATION.map((g) => ({ ...g, items: g.items.filter((i) => user.permissions.includes(i.permission)) })).filter((g) => g.items.length);
  return (
    <div className="min-h-screen">
      <Sidebar nav={nav} company={company?.name ?? ""} />
      <div className="lg:pl-64">
        <Topbar user={{ name: user.name, roleNames: user.roleNames }} notifications={notifications} />
        {user.mustChangePassword && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800">
            Please change your temporary password from <a href="/profile" className="font-medium underline">My profile</a>.
          </div>
        )}
        {licenceNote && (
          <div className={licenceNote === "red" ? "border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800" : "border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800"}>
            {licence.message}{" "}
            {user.permissions.includes("settings.view") && <a href="/settings?tab=licence" className="font-medium underline">Licence settings</a>}
          </div>
        )}
        <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
