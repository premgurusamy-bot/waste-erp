import { PartyDetail } from "@/components/shared/party-pages";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PartyDetail kind="supplier" params={params} />;
}
