import ConnectScreen from "./screens/ConnectScreen";
import TilingShell from "./components/TilingShell";
import { useAppStore } from "./store";

function App() {
  const screen = useAppStore((s) => s.screen);
  if (screen === "connect") return <ConnectScreen />;
  return <TilingShell />;
}

export default App;
