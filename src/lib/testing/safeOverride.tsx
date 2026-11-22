import { createContext, useContext, type ReactNode } from "react";

/**
 * SafeTest-style React Context override helper (Netflix #538):
 * lets DOM tests and Playwright mount real components with deterministic overrides
 * (clocks, device capabilities, watch-party transport, Tauri IPC) without mutating globals.
 */
export interface SafeOverride<T> {
  /** Wrap a subtree with an overridden value (or partial override merged via `merge`). */
  Provider: (props: { value: T; children: ReactNode }) => ReactNode;
  /** Read the active override inside a component, falling back to `defaultValue`. */
  use: () => T;
  /** Default value used in production when no test Provider is mounted. */
  defaultValue: T;
}

export function createOverride<T>(defaultValue: T): SafeOverride<T> {
  const Ctx = createContext<T>(defaultValue);
  function Provider({ value, children }: { value: T; children: ReactNode }) {
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }
  return {
    Provider,
    use: () => useContext(Ctx),
    defaultValue,
  };
}
