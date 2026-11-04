"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppState } from "@/lib/types";

export type AppContextValue = {
  state: AppState;
  day: string;
  interval: number;
  setDay: (day: string) => void;
  setInterval: (interval: number) => void;
  refresh: (opts?: { day?: string; interval?: number }) => Promise<void>;
  act: (action: string, payload?: Record<string, unknown>) => Promise<boolean | number>;
  busy: boolean;
  toast: (message: string, kind?: "ok" | "error") => void;
  openModal: (title: string, node: ReactNode, opts?: { wide?: boolean; sub?: string }) => void;
  closeModal: () => void;
  goTab: (tab: string) => void;
  isAdmin: boolean;
};

export const AppCtx = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppCtx);
  if (!value) throw new Error("useApp باید داخل AppCtx استفاده شود");
  return value;
}
