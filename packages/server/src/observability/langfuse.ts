import { CallbackHandler } from "langfuse-langchain";
import { env } from "../config.js";
import { resolveCredentials } from "../credentials/store.js";

export function getLangfuseHandler(runId: string, projectId: string) {
  const creds = resolveCredentials();
  const publicKey = creds.langfusePublicKey || env.LANGFUSE_PUBLIC_KEY;
  const secretKey = creds.langfuseSecretKey || env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    return null;
  }
  return new CallbackHandler({
    publicKey,
    secretKey,
    baseUrl: env.LANGFUSE_HOST,
    sessionId: runId,
    metadata: { project_id: projectId },
  });
}

export function buildTraceUrl(traceId: string): string {
  return `${env.LANGFUSE_HOST}/trace/${traceId}`;
}
