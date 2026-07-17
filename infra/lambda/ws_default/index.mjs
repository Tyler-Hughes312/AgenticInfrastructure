/**
 * $default stub — accepts frontend start/follow_up and chat actions.
 * Production should PostToConnection + Bedrock; this keeps the WS contract wired.
 */
export const handler = async (event) => {
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const action = body.action || body.type || "ping";
  const prompt = body.prompt || body.question || "";

  console.log(
    JSON.stringify({
      msg: "ws_default",
      connectionId: event.requestContext?.connectionId,
      action,
      bedrockModel: process.env.BEDROCK_MODEL_ID,
    })
  );

  // API Gateway Lambda proxy response for WebSocket routes
  if (action === "ping") {
    return {
      statusCode: 200,
      body: JSON.stringify({ type: "pong", ts: new Date().toISOString() }),
    };
  }

  if (action === "chat" || action === "start" || action === "follow_up") {
    return {
      statusCode: 200,
      body: JSON.stringify({
        event: "final_answer",
        data: {
          message:
            prompt
              ? `AWS stub received: ${String(prompt).slice(0, 200)}`
              : "AWS WebSocket connected. Bedrock handler pending full port.",
          bedrockModel: process.env.BEDROCK_MODEL_ID,
        },
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      event: "error",
      data: { message: `Unknown action: ${action}` },
    }),
  };
};
