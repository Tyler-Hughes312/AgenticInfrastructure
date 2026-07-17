/**
 * Enterprise network helpers: proxy env awareness for corp Windows PCs.
 * Node 22+ can honor HTTP(S)_PROXY via NODE_USE_ENV_PROXY=1.
 */
export function applyEnterpriseProxyHints(): void {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxy) return;

  if (!process.env.NODE_USE_ENV_PROXY) {
    process.env.NODE_USE_ENV_PROXY = "1";
    console.log(
      `[enterprise] set NODE_USE_ENV_PROXY=1 so Node fetch uses ${proxy.replace(/:[^:@/]+@/, ":****@")}`
    );
  } else {
    console.log(`[enterprise] proxy configured (${proxy.split("@").pop() ?? proxy})`);
  }

  if (!process.env.NO_PROXY) {
    process.env.NO_PROXY = "localhost,127.0.0.1,::1";
  }

  if (process.env.NODE_EXTRA_CA_CERTS) {
    console.log(`[enterprise] NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS}`);
  }
}

export function resolveApiHost(apiHost: string, enterpriseMode: boolean): string {
  if (enterpriseMode && (apiHost === "0.0.0.0" || apiHost === "::")) {
    return "127.0.0.1";
  }
  return apiHost;
}
