import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Collection, type Entity } from "@voyadesk/core";
import { api, ApiError } from "./api";
import { toast } from "./toast";

/* A tiny data cache: every mutation bumps a global version and every query re-runs. */
let version = 0;
const listeners = new Set<() => void>();
export function invalidate() {
  version += 1;
  listeners.forEach((l) => l());
}
function useVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

export function useQuery<T>(key: string, fn: () => Promise<T>, enabled = true): QueryState<T> {
  const v = useVersion();
  const [state, setState] = useState<{ data: T | undefined; error: ApiError | null; loading: boolean }>({ data: undefined, error: null, loading: enabled });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: unknown) => alive && setState((s) => ({ data: s.data, error: e instanceof ApiError ? e : new ApiError(String(e), 500), loading: false })),
    );
    return () => {
      alive = false;
    };
  }, [key, v, tick, enabled]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useList<C extends Collection>(c: C, enabled = true) {
  return useQuery<Entity<C>[]>(`list:${c}`, () => api.list(c), enabled);
}

export function useOne<C extends Collection>(c: C, id: string | undefined) {
  return useQuery<Entity<C>>(`one:${c}:${id ?? ""}`, () => api.get(c, id ?? ""), Boolean(id));
}

export function useReport<T>(name: string, params: Record<string, unknown> = {}, enabled = true) {
  return useQuery<T>(`report:${name}:${JSON.stringify(params)}`, () => api.report<T>(name, params), enabled);
}

/** Run a mutation with a busy flag, success toast and readable error toast. */
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true);
    setFieldErrors({});
    try {
      const r = await fn();
      invalidate();
      if (success) toast.success(typeof success === "function" ? success(r) : success);
      return r;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e), 500);
      if (err.fields) setFieldErrors(err.fields);
      toast.error(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, fieldErrors, setFieldErrors };
}

export function useAction() {
  const m = useMutation();
  const act = useCallback(<T,>(name: string, input: unknown, success?: string | ((r: T) => string)) => m.run(() => api.action<T>(name, input), success), [m]);
  return { ...m, act };
}

export function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return match;
}
