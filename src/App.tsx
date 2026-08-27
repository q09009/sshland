import { useEffect } from "react";
import ConnectScreen from "./screens/ConnectScreen";
import TilingShell from "./components/TilingShell";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import CommandLogBar from "./components/CommandLogBar";
import { useAppStore } from "./store";
import { useSettings } from "./lib/settings";
import { useCommandConfigs } from "./lib/commandConfigs";
import { useDashboardLayout } from "./lib/dashboardLayout";
import { useI18n } from "./i18n";
import ThemeController from "./components/ThemeController";

function App() {
  const screen = useAppStore((s) => s.screen);
  const loadSettings = useSettings((s) => s.load);
  const loadCommandConfigs = useCommandConfigs((s) => s.load);
  const { language } = useI18n();

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Load persisted settings and command-GUI configs once at startup, then seed
  // the dashboard layout from the loaded settings (so it survives a restart).
  useEffect(() => {
    void loadSettings().then(() => {
      useDashboardLayout
        .getState()
        .setWidgets(useSettings.getState().settings.dashboardLayout);
    });
    void loadCommandConfigs();
  }, [loadSettings, loadCommandConfigs]);

  const content =
    screen === "connect" ? (
      <ConnectScreen />
    ) : (
      // Files screen: a top status bar and a bottom command-log bar layered
      // above and below the pane tiling area, which fills the remaining space.
      <div className="flex h-full w-full flex-col">
        <StatusBar />
        <div className="min-h-0 flex-1">
          <TilingShell />
        </div>
        <CommandLogBar />
        <SettingsPanel />
      </div>
    );

  return (
    <>
      <ThemeController />
      <div className="relative z-10 h-full w-full">{content}</div>
    </>
  );
}

export default App;
