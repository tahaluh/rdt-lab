import { RdtDashboard } from "@/components/RdtDashboard";

export default function RunPage({ params }: { params: { runId: string } }) {
  return <RdtDashboard initialRunId={params.runId} />;
}
