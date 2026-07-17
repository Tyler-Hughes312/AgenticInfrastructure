import { cognitoConfig } from "./config";

const STORAGE_KEY = "agentic-cognito-session";

export type CognitoSession = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email?: string;
  sub?: string;
};

type CognitoAuthResult = {
  AuthenticationResult?: {
    IdToken?: string;
    AccessToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  };
  ChallengeName?: string;
  message?: string;
  __type?: string;
};

function idpUrl(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

async function cognitoCall<T>(
  target: string,
  body: Record<string, unknown>
): Promise<T> {
  const { region } = cognitoConfig();
  const res = await fetch(idpUrl(region), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & CognitoAuthResult;
  if (!res.ok) {
    const msg =
      (data as { message?: string; Message?: string }).message ||
      (data as { Message?: string }).Message ||
      `${target} failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) return {};
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as Record<string, unknown>;
}

export function loadSession(): CognitoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CognitoSession;
  } catch {
    return null;
  }
}

export function saveSession(session: CognitoSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function sessionFromAuth(
  result: NonNullable<CognitoAuthResult["AuthenticationResult"]>,
  priorRefresh?: string,
  email?: string
): CognitoSession {
  const idToken = result.IdToken ?? "";
  const accessToken = result.AccessToken ?? "";
  const refreshToken = result.RefreshToken ?? priorRefresh ?? "";
  const expiresIn = result.ExpiresIn ?? 3600;
  const claims = decodeJwtPayload(idToken);
  return {
    idToken,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000 - 60_000,
    email: email ?? (typeof claims.email === "string" ? claims.email : undefined),
    sub: typeof claims.sub === "string" ? claims.sub : undefined,
  };
}

export async function signUp(email: string, password: string): Promise<void> {
  const { clientId } = cognitoConfig();
  if (!clientId) throw new Error("Cognito client id not configured");
  await cognitoCall("SignUp", {
    ClientId: clientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  const { clientId } = cognitoConfig();
  await cognitoCall("ConfirmSignUp", {
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function signIn(email: string, password: string): Promise<CognitoSession> {
  const { clientId } = cognitoConfig();
  if (!clientId) throw new Error("Cognito client id not configured");

  const data = await cognitoCall<CognitoAuthResult>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: clientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  if (data.ChallengeName) {
    throw new Error(`Unsupported Cognito challenge: ${data.ChallengeName}`);
  }
  if (!data.AuthenticationResult?.IdToken) {
    throw new Error("Cognito sign-in returned no ID token");
  }

  const session = sessionFromAuth(data.AuthenticationResult, undefined, email);
  saveSession(session);
  return session;
}

export async function refreshSession(session: CognitoSession): Promise<CognitoSession> {
  const { clientId } = cognitoConfig();
  if (!session.refreshToken) throw new Error("No refresh token");

  const data = await cognitoCall<CognitoAuthResult>("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: clientId,
    AuthParameters: {
      REFRESH_TOKEN: session.refreshToken,
    },
  });

  if (!data.AuthenticationResult?.IdToken) {
    clearSession();
    throw new Error("Session refresh failed");
  }

  const next = sessionFromAuth(
    data.AuthenticationResult,
    session.refreshToken,
    session.email
  );
  saveSession(next);
  return next;
}

export async function signOut(): Promise<void> {
  const session = loadSession();
  const { clientId } = cognitoConfig();
  if (session?.accessToken && clientId) {
    try {
      await cognitoCall("GlobalSignOut", {
        AccessToken: session.accessToken,
      });
    } catch {
      // local clear still required
    }
  }
  clearSession();
}

/** Returns a valid Cognito ID token (API Gateway JWT authorizer requires aud). */
export async function getValidIdToken(): Promise<string | null> {
  let session = loadSession();
  if (!session?.idToken) return null;
  if (Date.now() < session.expiresAt) return session.idToken;
  try {
    session = await refreshSession(session);
    return session.idToken;
  } catch {
    clearSession();
    return null;
  }
}

export function getIdTokenSync(): string | null {
  const session = loadSession();
  if (!session?.idToken) return null;
  if (Date.now() >= session.expiresAt) return session.idToken; // best-effort; refresh async elsewhere
  return session.idToken;
}
