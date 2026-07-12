import { create } from "zustand";
import { CommandConfig, loadCommandConfigs } from "../api";

export type { CommandConfig };

/**
 * Find the first config whose `match` regex matches the command string. Pure so
 * it's easy to test. Invalid regexes are skipped (a bad config never throws).
 */
export function matchCommand(
  configs: CommandConfig[],
  command: string
): CommandConfig | null {
  const text = command.trim();
  for (const config of configs) {
    let re: RegExp;
    try {
      re = new RegExp(config.match);
    } catch {
      continue; // malformed regex — ignore this config
    }
    if (re.test(text)) return config;
  }
  return null;
}

interface CommandConfigsState {
  configs: CommandConfig[];
  loaded: boolean;
  /** (Re)load configs from the backend (defaults + user folder). */
  load: () => Promise<void>;
}

export const useCommandConfigs = create<CommandConfigsState>((set) => ({
  configs: [],
  loaded: false,
  load: async () => {
    try {
      const configs = await loadCommandConfigs();
      set({ configs, loaded: true });
    } catch {
      // Backend unavailable — keep whatever we have; feature just stays off.
      set({ loaded: true });
    }
  },
}));
