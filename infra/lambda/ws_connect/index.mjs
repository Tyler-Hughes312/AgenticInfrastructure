/**
 * $connect stub — records connection via env readiness only.
 * Production packaging should PutItem into TABLE_WS_CONNECTIONS.
 */
export const handler = async (event) => {
  console.log(
    JSON.stringify({
      msg: "ws_connect",
      connectionId: event.requestContext?.connectionId,
      sub: event.requestContext?.authorizer?.sub || null,
      table: process.env.TABLE_WS_CONNECTIONS || null,
    })
  );
  return { statusCode: 200, body: "connected" };
};
