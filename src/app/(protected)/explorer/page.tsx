import { LiveExplorer } from "@/components/Explorer";

// t_ux2_audit defect 1: the Wallet tab previously linked nowhere. This route
// gives it a real destination - the same read-only LiveExplorer product lane
// (auth-free GET routes only, no MiniKit command), now reachable in-app.
export default function ExplorerPage() {
  return <LiveExplorer />;
}
