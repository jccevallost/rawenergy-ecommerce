import { useEffect, useRef, useSyncExternalStore } from "react";
import { PanelNavigator, panelFilterValue } from "./panelRoute";
import type { Section } from "../components/layout/navigation";

let navigator: PanelNavigator | undefined;
let leaveGuard = async () => true;
function panelNavigator() {
  if (!navigator) navigator = new PanelNavigator({
    read: () => ({ hash: location.hash, index: Number.isInteger(history.state?.panelIndex) ? history.state.panelIndex : null }),
    push: (hash, index) => history.pushState({ ...history.state, panelIndex: index }, "", hash),
    replace: (hash, index) => history.replaceState({ ...history.state, panelIndex: index }, "", hash),
    go: delta => history.go(delta),
  }, () => leaveGuard());
  return navigator;
}

export function usePanelRoute(leave: () => Promise<boolean>) {
  const guard = useRef(leave); guard.current = leave;
  leaveGuard = () => guard.current();
  const controller = panelNavigator();
  const route = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    controller.initialize();
    const pop = () => { void controller.external(); };
    window.addEventListener("popstate", pop);
    window.addEventListener("hashchange", pop);
    return () => { window.removeEventListener("popstate", pop); window.removeEventListener("hashchange", pop); };
  }, [controller]);
  const go = async (section: Section, params?: Record<string, string>, force = false) => {
    const accepted = await controller.go(section, params, force);
    if (accepted) window.scrollTo({ top: 0 });
    return accepted;
  };
  return { route, go };
}

export function usePanelFilter<T>(key: string, fallback: T) {
  const controller = panelNavigator();
  const route = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const value = panelFilterValue(route, key, fallback);
  const update = (next: T | ((current: T) => T)) => {
    const current = panelFilterValue(controller.snapshot(), key, fallback);
    const result = typeof next === "function" ? (next as (current: T) => T)(current) : next;
    controller.patch({ [key]: String(result) });
  };
  return [value, update] as const;
}
