/**
 * REST API stub for API Gateway → Lambda.
 * Local Fastify remains the full app; this keeps GovCloud smoke paths alive.
 */
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-requested-with",
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const path = event.rawPath || event.path || "/";
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "authorization,content-type,x-requested-with",
      },
      body: "",
    };
  }

  if (method === "GET" && (path === "/health" || path.endsWith("/health"))) {
    return json(200, {
      ok: true,
      service: "agentic-rest",
      region: process.env.AWS_REGION,
      bedrockModel: process.env.BEDROCK_MODEL_ID,
      sub: claims.sub || null,
    });
  }

  // Minimal stubs so the Next.js client does not hard-fail against API Gateway
  if (method === "GET" && path === "/api/runs") return json(200, []);
  if (method === "GET" && path === "/api/chat-sessions") return json(200, []);
  if (method === "GET" && path === "/api/projects") return json(200, []);
  if (method === "GET" && path === "/api/graph-templates") return json(200, []);
  if (method === "GET" && path === "/api/settings/routing") {
    return json(200, { mode: "aws", note: "stub routing policy" });
  }
  if (method === "POST" && path === "/api/settings/status") {
    return json(200, {
      openai: false,
      copilot: false,
      bedrock: Boolean(process.env.BEDROCK_MODEL_ID),
      mode: "aws",
    });
  }
  if (method === "POST" && path === "/api/chat-sessions") {
    const id = `sess_${Date.now()}`;
    return json(200, {
      id,
      title: "AWS session",
      config: { agents: [], edges: [] },
      schema: {},
      messages: [],
      available_tools: [],
      available_skills: [],
    });
  }
  if (method === "GET" && path.startsWith("/api/chat-sessions/")) {
    const id = path.split("/").pop();
    return json(200, {
      id,
      title: "AWS session",
      config: { agents: [], edges: [] },
      schema: {},
      messages: [],
      available_tools: [],
      available_skills: [],
    });
  }

  return json(200, {
    message: "agentic rest stub — full Fastify routes not yet ported to Lambda",
    method,
    path,
    sub: claims.sub || null,
    tables: {
      runs: process.env.TABLE_RUNS,
      checkpoints: process.env.TABLE_CHECKPOINTS,
      users: process.env.TABLE_USERS,
    },
  });
};
