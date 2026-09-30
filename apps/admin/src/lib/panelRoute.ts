import { navigation, type Section } from "../components/layout/navigation";

export type PanelRoute = { section: Section; params: Record<string, string> };
export function parsePanelRoute(hash: string): PanelRoute {
  const value = hash.replace(/^#/, "");
  const separator = value.indexOf("?");
  const name = separator < 0 ? value : value.slice(0, separator);
  const query = separator < 0 ? "" : value.slice(separator + 1);
  const section = name === "import" || navigation.some(group => group.items.some(item => item.id === name)) ? name as Section : "home";
  return { section, params: Object.fromEntries(new URLSearchParams(query)) };
}
export function panelHash(route: PanelRoute) {
  const params = new URLSearchParams(Object.entries(route.params).filter(([, value]) => value !== "").sort(([a], [b]) => a.localeCompare(b)));
  return `#${route.section}${params.size ? `?${params}` : ""}`;
}
export function panelFilterValue<T>(route: PanelRoute, key: string, fallback: T): T {
  const value = route.params[key];
  if (value === undefined || value === "") return fallback;
  if (typeof fallback === "number") {
    const number = Number(value);
    return (Number.isFinite(number) && (!/(^|\.)page$/.test(key) || Number.isInteger(number) && number >= 0) ? number : fallback) as T;
  }
  if (typeof fallback === "boolean") return (value === "true" ? true : value === "false" ? false : fallback) as T;
  return value as T;
}

export type PanelHistory = {
  read: () => { hash: string; index: number | null };
  push: (hash: string, index: number) => void;
  replace: (hash: string, index: number) => void;
  go: (delta: number) => void;
};

/** Only committed routes reach forms. Browser history may move while a leave dialog is open. */
export class PanelNavigator {
  private route: PanelRoute;
  private index: number;
  private pending = false;
  private restoring = false;
  private views = new Map<Section, Record<string, string>>();
  private listeners = new Set<() => void>();
  constructor(private history: PanelHistory, private leave: () => Promise<boolean>) {
    const initial = history.read();
    this.route = parsePanelRoute(initial.hash);
    this.index = initial.index ?? 0;
    this.remember(this.route);
  }
  snapshot = () => this.route;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  initialize() { this.history.replace(panelHash(this.route), this.index); }
  private remember(route: PanelRoute) {
    const { record: _record, ...filters } = route.params;
    this.views.set(route.section, filters);
  }
  private apply(route: PanelRoute) {
    this.remember(this.route);
    this.route = route;
    this.remember(route);
    this.listeners.forEach(listener => listener());
  }
  patch(params: Record<string, string>) {
    if (this.pending || this.restoring) return false;
    const next = { ...this.route, params: { ...this.route.params, ...params } };
    this.history.replace(panelHash(next), this.index);
    this.apply(next);
    return true;
  }
  async go(section: Section, params?: Record<string, string>, force = false) {
    if (this.pending || this.restoring) return false;
    const remembered = this.views.get(section) ?? {};
    const next = { section, params: params && Object.keys(params).every(key => key === "record") ? { ...remembered, ...params } : params ?? remembered };
    if (panelHash(next) === panelHash(this.route)) return true;
    this.pending = true;
    try {
      if (!force && !await this.leave()) return false;
      if (force) this.history.replace(panelHash(next), this.index);
      else this.history.push(panelHash(next), ++this.index);
      this.apply(next);
      return true;
    } finally { this.pending = false; }
  }
  async external() {
    const observed = this.history.read();
    const next = parsePanelRoute(observed.hash);
    if (this.restoring) {
      if (panelHash(next) === panelHash(this.route)) this.restoring = false;
      return;
    }
    if (this.pending || panelHash(next) === panelHash(this.route)) return;
    this.pending = true;
    try {
      const accepted = await this.leave();
      // A second Back/Forward gesture can occur while the dialog is still open.
      const current = this.history.read();
      if (accepted) {
        this.index = current.index === null || current.index === this.index ? this.index + 1 : current.index;
        const route = parsePanelRoute(current.hash);
        this.history.replace(panelHash(route), this.index);
        this.apply(route);
      } else if (current.index !== null && current.index !== this.index) {
        this.restoring = true;
        this.history.go(this.index - current.index);
      } else this.history.replace(panelHash(this.route), this.index);
    } finally { this.pending = false; }
  }
}
