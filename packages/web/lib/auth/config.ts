/**
 * Frontend ↔ AWS wiring config.
 * Local Fastify: leave Cognito vars unset.
 * GovCloud: set Cognito + API Gateway URLs (see infra/scripts/sync-web-env.sh).
 */

export type AuthMode = "local" | "cognito";

export function getAuthMode(): AuthMode {
  const explicit = process.env.NEXT_PUBLIC_AUTH_MODE?.trim().toLowerCase();
  if (explicit === "cognito") return "cognito";
  if (explicit === "local") return "local";
  return process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ? "cognito" : "local";
}

export function isAwsBackend(): boolean {
  return getAuthMode() === "cognito";
}

export function cognitoConfig() {
  const region = process.env.NEXT_PUBLIC_COGNITO_REGION ?? "us-gov-west-1";
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "";
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
  const issuer =
    process.env.NEXT_PUBLIC_COGNITO_ISSUER_URL ??
    (userPoolId ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}` : "");

  return { region, userPoolId, clientId, issuer };
}

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
}

export function wsBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000").replace(/\/$/, "");
}
