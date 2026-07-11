import ConnectScreen from "./screens/ConnectScreen";
import FilesScreen from "./screens/FilesScreen";
import TerminalPane from "./components/TerminalPane";
import { useAppStore } from "./store";

function App() {
  const screen = useAppStore((s) => s.screen);
  if (screen === "connect") return <ConnectScreen />;

  // TEMP(terminal step 2): file manager + one terminal side by side to verify
  // PTY streaming. Replaced by the pane tree in the next step.
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 border-r border-ink-700">
        <FilesScreen />
      </div>
      <div className="min-w-0 flex-1">
        <TerminalPane id="terminal-hardcoded-1" />
      </div>
    </div>
  );
}

export default App;
