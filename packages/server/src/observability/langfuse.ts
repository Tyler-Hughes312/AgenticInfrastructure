import { CallbackHandler } from "langfuse-langchain";
import { env } from "../config.js";
import { resolveCredentials } from "../credentials/store.js";

export function isLangfuseConfigured(): boolean {
  const creds = resolveCredentials();
  const publicKey = creds.langfusePublicKey || env.LANGFUSE_PUBLIC_KEY;
  const secretKey = creds.langfuseSecretKey || env.LANGFUSE_SECRET_KEY;
  return Boolean(publicKey && secretKey);
}

export function getLangfuseHandler(runId: string, projectId: string) {
  if (!isLangfuseConfigured()) {
    return null;
  }
  const creds = resolveCredentials();
  const publicKey = creds.langfusePublicKey || env.LANGFUSE_PUBLIC_KEY;
  const secretKey = creds.langfuseSecretKey || env.LANGFUSE_SECRET_KEY;
  return new CallbackHandler({
    publicKey: publicKey!,
    secretKey: secretKey!,
    baseUrl: env.LANGFUSE_HOST,
    sessionId: runId,
    metadata: { project_id: projectId },
  });
}

export function buildTraceUrl(traceId: string): string | undefined {
  if (!isLangfuseConfigured()) {
    return undefined;
  }
  return `${env.LANGFUSE_HOST}/trace/${traceId}`;
}
