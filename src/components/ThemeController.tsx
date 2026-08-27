import { useEffect } from "react";
import { useSettings } from "../lib/settings";
import { applyTheme } from "../lib/theme";

/** Applies persisted theme values and paints the app-wide backdrop. */
export default function ThemeController() {
  const theme = useSettings((state) => state.settings.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="theme-backdrop" aria-hidden="true">
      <div className="theme-backdrop-image" />
      <div className="theme-backdrop-overlay" />
    </div>
  );
}
