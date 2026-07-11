import { useEffect } from "react";
import ConnectScreen from "./screens/ConnectScreen";
import TilingShell from "./components/TilingShell";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import CommandLogBar from "./components/CommandLogBar";
import { useAppStore } from "./store";
import { useSettings } from "./lib/settings";

function App() {
  const screen = useAppStore((s) => s.screen);
  const loadSettings = useSettings((s) => s.load);

  // Load persisted settings once at startup.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  if (screen === "connect") return <ConnectScreen />;

  // Files screen: a top status bar and a bottom command-log bar layered above
  // and below the pane tiling area, which fills the remaining space. The
  // settings overlay covers the tiling when open.
  return (
    <div className="flex h-full w-full flex-col">
      <StatusBar />
      <div className="min-h-0 flex-1">
        <TilingShell />
      </div>
      <CommandLogBar />
      <SettingsPanel />
    </div>
  );
}

export default App;
