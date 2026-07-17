/**
 * WebSocket REQUEST authorizer — must return an IAM policy document
 * (WebSocket APIs do not support simple isAuthorized responses).
 *
 * Clients connect with: wss://…/dev?token=<cognito_jwt>
 */
export const handler = async (event) => {
  const token =
    event.queryStringParameters?.token ||
    (Array.isArray(event.identitySource) ? event.identitySource[0] : "") ||
    "";

  const issuer = (process.env.COGNITO_ISSUER_URL || "").replace(/\/$/, "");
  const clientId = process.env.COGNITO_CLIENT_ID || "";
  const methodArn = event.methodArn;

  const deny = () => ({
    principalId: "unauthorized",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: "Deny",
          Resource: methodArn,
        },
      ],
    },
  });

  try {
    const raw = String(token).replace(/^Bearer\s+/i, "");
    const parts = raw.split(".");
    if (parts.length !== 3) return deny();

    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );

    if (issuer && payload.iss) {
      const iss = String(payload.iss).replace(/\/$/, "");
      if (iss !== issuer && !iss.startsWith(issuer)) return deny();
    }

    if (clientId) {
      const audOk = payload.aud === clientId || payload.client_id === clientId;
      if (!audOk) return deny();
    }

    if (payload.exp && Date.now() / 1000 > Number(payload.exp)) return deny();

    const sub = String(payload.sub || "user");

    return {
      principalId: sub,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: methodArn,
          },
        ],
      },
      context: {
        sub,
        email: String(payload.email || ""),
      },
    };
  } catch {
    return deny();
  }
};
