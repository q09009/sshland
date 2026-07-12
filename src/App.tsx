import { useEffect } from "react";
import ConnectScreen from "./screens/ConnectScreen";
import TilingShell from "./components/TilingShell";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import CommandLogBar from "./components/CommandLogBar";
import { useAppStore } from "./store";
import { useSettings } from "./lib/settings";
import { useCommandConfigs } from "./lib/commandConfigs";

function App() {
  const screen = useAppStore((s) => s.screen);
  const loadSettings = useSettings((s) => s.load);
  const loadCommandConfigs = useCommandConfigs((s) => s.load);

  // Load persisted settings and command-GUI configs once at startup.
  useEffect(() => {
    void loadSettings();
    void loadCommandConfigs();
  }, [loadSettings, loadCommandConfigs]);

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
