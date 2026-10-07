import { PartyList } from "@/components/shared/party-pages";
import type { SP } from "@/lib/list-params";

export const metadata = { title: "Suppliers" };

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return <PartyList kind="supplier" searchParams={searchParams} />;
}
