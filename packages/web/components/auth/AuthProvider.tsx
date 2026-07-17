"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAuthMode, isAwsBackend } from "../../lib/auth/config";
import {
  clearSession,
  confirmSignUp,
  getValidIdToken,
  loadSession,
  signIn,
  signOut as cognitoSignOut,
  signUp,
  type CognitoSession,
} from "../../lib/auth/cognito";

type AuthContextValue = {
  mode: "local" | "cognito";
  ready: boolean;
  session: CognitoSession | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = new Set(["/login"]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const mode = getAuthMode();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(mode === "local");
  const [session, setSession] = useState<CognitoSession | null>(null);

  useEffect(() => {
    if (mode !== "cognito") {
      setReady(true);
      return;
    }
    const existing = loadSession();
    setSession(existing);
    void (async () => {
      if (existing) {
        const token = await getValidIdToken();
        if (!token) {
          clearSession();
          setSession(null);
        } else {
          setSession(loadSession());
        }
      }
      setReady(true);
    })();
  }, [mode]);

  useEffect(() => {
    if (!ready || mode !== "cognito") return;
    if (!session && pathname && !PUBLIC_PATHS.has(pathname)) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, mode, session, pathname, router]);

  const handleSignIn = useCallback(async (email: string, password: string) => {
    const next = await signIn(email, password);
    setSession(next);
  }, []);

  const handleSignUp = useCallback(async (email: string, password: string) => {
    await signUp(email, password);
  }, []);

  const handleConfirm = useCallback(async (email: string, code: string) => {
    await confirmSignUp(email, code);
  }, []);

  const handleSignOut = useCallback(async () => {
    await cognitoSignOut();
    setSession(null);
    if (isAwsBackend()) router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      ready,
      session,
      email: session?.email ?? null,
      signIn: handleSignIn,
      signUp: handleSignUp,
      confirmSignUp: handleConfirm,
      signOut: handleSignOut,
      getIdToken: getValidIdToken,
    }),
    [mode, ready, session, handleSignIn, handleSignUp, handleConfirm, handleSignOut]
  );

  if (!ready) {
    return (
      <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
        Checking session…
      </div>
    );
  }

  if (mode === "cognito" && !session && pathname && !PUBLIC_PATHS.has(pathname)) {
    return (
      <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
        Redirecting to login…
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
