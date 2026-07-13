import { create } from "zustand";
import {
  Macro,
  MacroStep,
  deleteMacro,
  listMacros,
  saveMacro,
} from "../api";

export type { Macro, MacroStep };

/** Find a macro by id in a loaded list, or null. Pure (easy to test). */
export function findMacro(macros: Macro[], id: string): Macro | null {
  return macros.find((m) => m.id === id) ?? null;
}

interface MacrosState {
  macros: Macro[];
  loaded: boolean;
  /** (Re)load all macros from the backend folder. */
  load: () => Promise<void>;
  /** Persist a macro (create or overwrite) and refresh the cache. */
  save: (mac: Macro) => Promise<void>;
  /** Delete a macro by id and refresh the cache. */
  remove: (id: string) => Promise<void>;
}

export const useMacros = create<MacrosState>((set) => ({
  macros: [],
  loaded: false,
  load: async () => {
    try {
      const macros = await listMacros();
      set({ macros, loaded: true });
    } catch {
      // Backend unavailable — keep whatever we have; the feature just stays empty.
      set({ loaded: true });
    }
  },
  save: async (mac) => {
    await saveMacro(mac);
    // Update the cache in place so callers see it immediately.
    set((s) => {
      const rest = s.macros.filter((m) => m.id !== mac.id);
      return { macros: [...rest, mac].sort((a, b) => a.name.localeCompare(b.name)) };
    });
  },
  remove: async (id) => {
    await deleteMacro(id);
    set((s) => ({ macros: s.macros.filter((m) => m.id !== id) }));
  },
}));

/** Make a new, empty macro (frontend-generated id). */
export function newMacro(name = ""): Macro {
  return { id: crypto.randomUUID(), name, steps: [] };
}

/** Make a new, empty macro step (frontend-generated id). */
export function newMacroStep(): MacroStep {
  return { id: crypto.randomUUID(), label: "", command: "" };
}
