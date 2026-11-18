import AutopilotPanel from "@/components/dashboard/AutopilotPanel";

// The dashboard page itself stays untouched; the Autopilot panel (proposals, meetings, workspace) floats above it.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AutopilotPanel />
    </>
  );
}
