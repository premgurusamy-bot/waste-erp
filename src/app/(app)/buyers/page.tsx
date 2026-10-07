import { PartyList } from "@/components/shared/party-pages";
import type { SP } from "@/lib/list-params";

export const metadata = { title: "Buyers" };

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return <PartyList kind="buyer" searchParams={searchParams} />;
}
