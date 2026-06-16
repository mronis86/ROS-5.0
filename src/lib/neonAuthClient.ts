import { createAuthClient } from '@neondatabase/neon-js/auth';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();

export const isNeonAuthEnabled = Boolean(neonAuthUrl);

let cachedClient: ReturnType<typeof createAuthClient> | null = null;

export function getNeonAuthClient() {
  if (!neonAuthUrl) return null;
  if (!cachedClient) {
    cachedClient = createAuthClient(neonAuthUrl);
  }
  return cachedClient;
}

export async function fetchNeonAccessToken(): Promise<string | null> {
  const client = getNeonAuthClient();
  if (!client) return null;
  try {
    const sessionResult = await client.getSession();
    const existing = sessionResult.data?.session?.access_token;
    if (typeof existing === 'string' && existing) return existing;

    const tokenResult = await client.token();
    if (tokenResult.error || !tokenResult.data?.token) return null;
    return tokenResult.data.token;
  } catch (err) {
    console.error('[neonAuth] Failed to fetch access token:', err);
    return null;
  }
}
