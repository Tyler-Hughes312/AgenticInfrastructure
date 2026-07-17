"use client";

import React, { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../components/auth/AuthProvider";
import { isAwsBackend } from "../../lib/auth/config";

type Mode = "signin" | "signup" | "confirm";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = useMemo(() => {
    if (mode === "signup") return "Create account";
    if (mode === "confirm") return "Confirm email";
    return "Sign in";
  }, [mode]);

  if (!isAwsBackend()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-charcoal-bg px-4">
        <div className="max-w-md w-full border border-charcoal-border bg-charcoal-surface p-6 rounded-lg">
          <h1 className="text-lg font-medium text-charcoal-text mb-2">Local mode</h1>
          <p className="text-sm text-charcoal-muted mb-4">
            Cognito login is disabled. Point the app at GovCloud with{" "}
            <code className="text-charcoal-accent">npm run infra:sync-web-env</code> after
            deploy, or set <code className="text-charcoal-accent">NEXT_PUBLIC_AUTH_MODE=cognito</code>.
          </p>
          <button
            type="button"
            className="px-3 py-2 text-sm bg-charcoal-accent text-white rounded"
            onClick={() => router.push("/")}
          >
            Continue to app
          </button>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await auth.signIn(email.trim(), password);
        router.replace(next);
        return;
      }
      if (mode === "signup") {
        await auth.signUp(email.trim(), password);
        setInfo("Check your email for a confirmation code.");
        setMode("confirm");
        return;
      }
      await auth.confirmSignUp(email.trim(), code.trim());
      setInfo("Email confirmed. Sign in.");
      setMode("signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-charcoal-bg px-4">
      <div className="max-w-md w-full border border-charcoal-border bg-charcoal-surface p-6 rounded-lg shadow-lg">
        <p className="text-xs uppercase tracking-wide text-charcoal-muted mb-1">
          Agentic · GovCloud
        </p>
        <h1 className="text-xl font-medium text-charcoal-text mb-4">{title}</h1>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm text-charcoal-muted">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-charcoal-border bg-charcoal-bg px-3 py-2 text-charcoal-text"
            />
          </label>

          {mode !== "confirm" && (
            <label className="block text-sm text-charcoal-muted">
              Password
              <input
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded border border-charcoal-border bg-charcoal-bg px-3 py-2 text-charcoal-text"
              />
            </label>
          )}

          {mode === "confirm" && (
            <label className="block text-sm text-charcoal-muted">
              Confirmation code
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-full rounded border border-charcoal-border bg-charcoal-bg px-3 py-2 text-charcoal-text"
              />
            </label>
          )}

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          {info && <p className="text-sm text-charcoal-accent">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-charcoal-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Working…" : title}
          </button>
        </form>

        <div className="mt-4 flex gap-3 text-sm text-charcoal-muted">
          {mode !== "signin" && (
            <button type="button" className="underline" onClick={() => setMode("signin")}>
              Sign in
            </button>
          )}
          {mode !== "signup" && (
            <button type="button" className="underline" onClick={() => setMode("signup")}>
              Create account
            </button>
          )}
          {mode !== "confirm" && (
            <button type="button" className="underline" onClick={() => setMode("confirm")}>
              Confirm email
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
