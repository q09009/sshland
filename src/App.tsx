import ConnectScreen from "./screens/ConnectScreen";
import FilesScreen from "./screens/FilesScreen";
import { useAppStore } from "./store";

function App() {
  const screen = useAppStore((s) => s.screen);
  return screen === "connect" ? <ConnectScreen /> : <FilesScreen />;
}

export default App;
