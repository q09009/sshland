import ConnectScreen from "./screens/ConnectScreen";
import PaneView from "./components/PaneView";
import { useAppStore } from "./store";

function App() {
  const screen = useAppStore((s) => s.screen);
  const paneTree = useAppStore((s) => s.paneTree);

  if (screen === "connect") return <ConnectScreen />;
  return <PaneView node={paneTree} />;
}

export default App;
