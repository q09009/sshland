import { useEffect, useLayoutEffect } from "react";
import { create } from "zustand";
import type { DropItem } from "../components/Menu";

/** One contextual menu exposed by a pane to the app-wide top bar. */
export interface PaneMenuGroup {
  label: string;
  items: DropItem[];
}

interface PaneMenuState {
  byPane: Record<string, PaneMenuGroup[]>;
  setMenus: (paneId: string, menus: PaneMenuGroup[]) => void;
  removeMenus: (paneId: string) => void;
}

export const usePaneMenuStore = create<PaneMenuState>((set) => ({
  byPane: {},
  setMenus: (paneId, menus) =>
    set((state) => ({ byPane: { ...state.byPane, [paneId]: menus } })),
  removeMenus: (paneId) =>
    set((state) => {
      if (!state.byPane[paneId]) return state;
      const byPane = { ...state.byPane };
      delete byPane[paneId];
      return { byPane };
    }),
}));

/**
 * Publish a pane's current menu model without moving its local state globally.
 * Only the focused pane's model is selected by the top bar, so background pane
 * updates do not cause it to re-render.
 */
export function usePaneMenuRegistration(
  paneId: string,
  menus: PaneMenuGroup[]
) {
  const setMenus = usePaneMenuStore((state) => state.setMenus);
  const removeMenus = usePaneMenuStore((state) => state.removeMenus);

  useLayoutEffect(() => {
    setMenus(paneId, menus);
  }, [menus, paneId, setMenus]);

  useEffect(
    () => () => {
      removeMenus(paneId);
    },
    [paneId, removeMenus]
  );
}
