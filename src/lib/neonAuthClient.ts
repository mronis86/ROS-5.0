import { createAuthClient } from '@neondatabase/neon-js/auth';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();

export const isNeonAuthEnabled = Boolean(neonAuthUrl);

type NeonAuthClient = ReturnType<typeof createAuthClient> & {
  getJWTToken?: (allowAnonymous?: boolean) => Promise<string | null>;
};

let cachedClient: NeonAuthClient | null = null;

export function getNeonAuthClient(): NeonAuthClient | null {
  if (!neonAuthUrl) return null;
  if (!cachedClient) {
    cachedClient = createAuthClient(neonAuthUrl) as NeonAuthClient;
  }
  return cachedClient;
}

type SessionLike = { token?: string; access_token?: string } | null | undefined;

function readSessionToken(session: SessionLike): string | null {
  if (!session) return null;
  if (typeof session.token === 'string' && session.token) return session.token;
  if (typeof session.access_token === 'string' && session.access_token) return session.access_token;
  return null;
}

export function extractTokenFromAuthResult(result: unknown): string | null {
  const data = (result as { data?: { session?: SessionLike } })?.data;
  return readSessionToken(data?.session);
}

export async function fetchNeonAccessToken(): Promise<string | null> {
  const client = getNeonAuthClient();
  if (!client) return null;
  try {
    if (typeof client.getJWTToken === 'function') {
      const jwt = await client.getJWTToken();
      if (jwt) return jwt;
    }

    let sessionResult = await client.getSession();
    let token = readSessionToken(sessionResult.data?.session);
    if (token) return token;

    // Session cache can lag immediately after sign-in — force a refresh once.
    sessionResult = await client.getSession({
      fetchOptions: { headers: { 'X-Force-Fetch': 'true' } },
    });
    token = readSessionToken(sessionResult.data?.session);
    if (token) return token;

    if (typeof client.token === 'function') {
      const tokenResult = await client.token();
      const fromTokenEndpoint =
        tokenResult?.data?.token ?? tokenResult?.data?.access_token ?? tokenResult?.data?.jwt;
      if (typeof fromTokenEndpoint === 'string' && fromTokenEndpoint) return fromTokenEndpoint;
    }

    return null;
  } catch (err) {
    console.error('[neonAuth] Failed to fetch access token:', err);
    return null;
  }
}
