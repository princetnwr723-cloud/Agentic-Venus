import AutopilotPanel from "@/components/dashboard/AutopilotPanel";
import MeetingIsland from "@/components/dashboard/MeetingIsland";

// The dashboard page itself stays untouched; the Autopilot panel (proposals, meetings, workspace) and the meeting card
// (what the agent is doing in a call right now) float above it.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <MeetingIsland />
      <AutopilotPanel />
    </>
  );
}
