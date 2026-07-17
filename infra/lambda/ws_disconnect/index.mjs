/**
 * $disconnect stub.
 * Production packaging should DeleteItem from TABLE_WS_CONNECTIONS.
 */
export const handler = async (event) => {
  console.log(
    JSON.stringify({
      msg: "ws_disconnect",
      connectionId: event.requestContext?.connectionId,
      table: process.env.TABLE_WS_CONNECTIONS || null,
    })
  );
  return { statusCode: 200, body: "disconnected" };
};
