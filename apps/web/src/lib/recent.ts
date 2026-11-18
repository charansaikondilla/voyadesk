import { useEffect } from "react";

/** Records you opened recently (per browser), shown first in search for one-keystroke jumps back. */
export interface RecentItem { to: string; label: string; hint?: string; kind: string; at: number }

const KEY = "voyadesk.recent";
const MAX = 8;

export function readRecent(): RecentItem[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as RecentItem[]).filter((x) => x && typeof x.to === "string" && typeof x.label === "string") : [];
  } catch {
    return [];
  }
}

function write(items: RecentItem[]) {
  try { window.localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: memory only */ }
}

export function pushRecent(item: Omit<RecentItem, "at">) {
  const rest = readRecent().filter((x) => x.to !== item.to);
  write([{ ...item, at: Date.now() }, ...rest].slice(0, MAX));
}

/** Remember the record on screen once its label is known. */
export function useRecent(item: Omit<RecentItem, "at"> | null) {
  const sig = item ? `${item.to}|${item.label}|${item.hint ?? ""}` : "";
  useEffect(() => {
    if (item) pushRecent(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
