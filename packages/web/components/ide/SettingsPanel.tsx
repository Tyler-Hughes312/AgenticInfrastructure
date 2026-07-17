"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_CREDENTIALS,
  loadCredentials,
  saveCredentials,
  type StoredCredentials,
} from "../../lib/credentials";
import { fetchCredentialsStatus } from "../../app/api-client";
import { useAuth } from "../auth/AuthProvider";
import { isAwsBackend } from "../../lib/auth/config";

type CredentialsStatus = {
  github_token: boolean;
  github_copilot_token: boolean;
  openai_api_key: boolean;
  model_primary: string;
  model_fallback: string;
  default_repo_url: string;
  langfuse_configured: boolean;
  source: string;
};

const inputClass =
  "w-full p-3 rounded-lg border border-charcoal-border bg-charcoal-raised text-charcoal-text placeholder:text-charcoal-muted/50 focus:border-charcoal-accent focus:ring-2 focus:ring-charcoal-accent/30 focus:outline-none";

const cardClass = "bg-charcoal-surface rounded-xl border border-charcoal-border p-5";

function StatusBadge({
  ok,
  label,
  optional,
}: {
  ok: boolean;
  label: string;
  optional?: boolean;
}) {
  const tone =
    ok
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
      : optional
        ? "bg-charcoal-raised text-charcoal-muted border-charcoal-border"
        : "bg-amber-500/10 text-amber-400 border-amber-500/25";
  const dot = ok ? "bg-emerald-400" : optional ? "bg-charcoal-muted" : "bg-amber-400";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${tone}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export default function SettingsPanel() {
  const auth = useAuth();
  const [form, setForm] = useState<StoredCredentials>(DEFAULT_CREDENTIALS);
  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(loadCredentials());
  }, []);

  async function checkStatus(credentials: StoredCredentials) {
    try {
      const result = await fetchCredentialsStatus(credentials);
      setStatus(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check status");
    }
  }

  useEffect(() => {
    if (form.githubToken || form.githubCopilotToken || form.openaiApiKey) {
      void checkStatus(form);
    }
  }, [form]);

  function updateField<K extends keyof StoredCredentials>(key: K, value: StoredCredentials[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Persist immediately so orchestrator websocket reads the same keys status checks use.
      saveCredentials(next);
      return next;
    });
    setSaved(true);
  }

  function handleSave() {
    saveCredentials(form);
    setSaved(true);
    void checkStatus(form);
  }

  return (
    <div className="h-full overflow-y-auto bg-charcoal-bg text-charcoal-text">
      <div className="max-w-2xl mx-auto w-full p-6 md:p-8 space-y-5">
        <header>
          <h1 className="text-xl font-semibold text-charcoal-text tracking-tight">Settings</h1>
          <p className="text-charcoal-muted mt-1 text-sm">
            API tokens are stored in your browser and sent with each orchestrator run. Changes save
            automatically.
          </p>
        </header>

        {isAwsBackend() && (
          <section className={cardClass}>
            <h2 className="text-sm font-semibold mb-2 text-charcoal-text">AWS Cognito</h2>
            <p className="text-sm text-charcoal-muted mb-3">
              Signed in as{" "}
              <span className="text-charcoal-text">{auth.email ?? "unknown"}</span>. HTTP and
              WebSocket calls use your Cognito ID token against API Gateway.
            </p>
            <button
              type="button"
              onClick={() => void auth.signOut()}
              className="px-3 py-2 text-sm rounded-lg border border-charcoal-border hover:border-charcoal-accent"
            >
              Sign out
            </button>
          </section>
        )}

        {status && (
          <section className={cardClass}>
            <h2 className="text-sm font-semibold mb-3 text-charcoal-text">Connection status</h2>
            <div className="flex flex-wrap gap-2">
              <StatusBadge ok={status.github_token} label="GitHub token" />
              <StatusBadge ok={status.github_copilot_token} label="Copilot token" />
              <StatusBadge ok={status.openai_api_key} label="OpenAI key" />
              <StatusBadge
                ok={Boolean(status.default_repo_url)}
                optional
                label={status.default_repo_url ? "Default repo" : "Repo optional"}
              />
              <StatusBadge ok={status.langfuse_configured} label="Langfuse" />
            </div>
            <p className="text-xs text-charcoal-muted mt-3">Source: {status.source}</p>
          </section>
        )}

        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <section className={cardClass}>
          <h2 className="text-sm font-semibold mb-4 text-charcoal-text">Repository</h2>
          <p className="text-xs text-charcoal-muted mb-4">
            Optional. Leave blank to chat with the orchestrator without cloning a git repo. Set a
            URL when agents need to edit code or open PRs.
          </p>
          <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
            Default repository URL
          </label>
          <input
            type="url"
            className={inputClass}
            placeholder="https://github.com/org/repo (optional)"
            value={form.defaultRepoUrl}
            onChange={(e) => updateField("defaultRepoUrl", e.target.value)}
          />
        </section>

        <section className={cardClass}>
          <h2 className="text-sm font-semibold mb-4 text-charcoal-text">Credentials</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                GitHub personal access token
              </label>
              <input
                type="password"
                className={inputClass}
                placeholder="ghp_..."
                value={form.githubToken}
                onChange={(e) => updateField("githubToken", e.target.value)}
              />
              <p className="text-xs text-charcoal-muted mt-1.5">
                Used for cloning repos and opening pull requests.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                GitHub Copilot token
              </label>
              <input
                type="password"
                className={inputClass}
                placeholder="From copilot login or Settings"
                value={form.githubCopilotToken}
                onChange={(e) => updateField("githubCopilotToken", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                OpenAI API key
              </label>
              <input
                type="password"
                className={inputClass}
                placeholder="sk-..."
                value={form.openaiApiKey}
                onChange={(e) => updateField("openaiApiKey", e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="text-sm font-semibold mb-4 text-charcoal-text">Models</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                Primary model
              </label>
              <input
                type="text"
                className={inputClass}
                value={form.modelPrimary}
                onChange={(e) => updateField("modelPrimary", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                Fallback model
              </label>
              <input
                type="text"
                className={inputClass}
                value={form.modelFallback}
                onChange={(e) => updateField("modelFallback", e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-charcoal-muted mt-3">
            Format: <code className="bg-charcoal-raised px-1.5 py-0.5 rounded text-charcoal-text">copilot:gpt-4o</code>{" "}
            or{" "}
            <code className="bg-charcoal-raised px-1.5 py-0.5 rounded text-charcoal-text">openai:gpt-4.1</code>
          </p>
        </section>

        <section className={cardClass}>
          <h2 className="text-sm font-semibold mb-4 text-charcoal-text">Observability</h2>
          <p className="text-xs text-charcoal-muted mb-4">Optional Langfuse tracing keys.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                Langfuse public key
              </label>
              <input
                type="password"
                className={inputClass}
                value={form.langfusePublicKey}
                onChange={(e) => updateField("langfusePublicKey", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal-muted mb-1.5">
                Langfuse secret key
              </label>
              <input
                type="password"
                className={inputClass}
                value={form.langfuseSecretKey}
                onChange={(e) => updateField("langfuseSecretKey", e.target.value)}
              />
            </div>
          </div>
        </section>

        <div className="pt-1">
          <button
            type="button"
            onClick={handleSave}
            className="w-full py-2.5 rounded-lg bg-charcoal-accent text-white font-medium hover:brightness-110 transition-colors"
          >
            Save settings
          </button>
          {saved && (
            <p className="text-center text-sm text-emerald-400 mt-3">
              Saved in this browser — ready for orchestrator runs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
