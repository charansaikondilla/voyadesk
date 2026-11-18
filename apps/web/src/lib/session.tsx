import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { type ModuleKey, type Settings, type User } from "@voyadesk/core";
import { api, ApiError, demoSession, HttpApi, LocalApi } from "./api";
import { invalidate } from "./hooks";

interface SessionValue {
  user: User | null;
  settings: Settings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signInDemo: (userId: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  moduleOn: (m: ModuleKey) => boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.me();
      setUser(r.user);
      setSettings(r.settings);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401 || e.status === 403) {
        setUser(null);
        setSettings(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signInDemo = useCallback(async (userId: string) => {
    if (!(api instanceof LocalApi)) return;
    api.userId = userId;
    demoSession.set(userId);
    await refresh();
    invalidate();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!(api instanceof HttpApi)) return;
    await api.login(email, password);
    await refresh();
    invalidate();
  }, [refresh]);

  const signOut = useCallback(() => {
    if (api instanceof LocalApi) {
      api.userId = null;
      demoSession.set(null);
    }
    if (api instanceof HttpApi) api.setToken(null);
    setUser(null);
    setSettings(null);
    invalidate();
  }, []);

  const moduleOn = useCallback((m: ModuleKey) => Boolean(settings?.modules?.[m]), [settings]);

  return <Ctx.Provider value={{ user, settings, loading, refresh, signInDemo, signIn, signOut, moduleOn }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
