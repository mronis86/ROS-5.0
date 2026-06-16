import { createAuthClient } from '@neondatabase/neon-js/auth';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();

export const isNeonAuthEnabled = Boolean(neonAuthUrl);

type NeonAuthClient = ReturnType<typeof createAuthClient>;

let cachedClient: NeonAuthClient | null = null;

export function getNeonAuthClient(): NeonAuthClient | null {
  if (!neonAuthUrl) return null;
  if (!cachedClient) {
    cachedClient = createAuthClient(neonAuthUrl);
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

async function readTokenFromSession(client: NeonAuthClient, forceFetch = false): Promise<string | null> {
  const sessionResult = forceFetch
    ? await client.getSession({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } })
    : await client.getSession();
  return readSessionToken(sessionResult.data?.session);
}

async function readTokenFromTokenEndpoint(client: NeonAuthClient): Promise<string | null> {
  if (typeof client.token !== 'function') return null;
  const tokenResult = await client.token();
  const value = tokenResult?.data?.token ?? tokenResult?.data?.access_token ?? tokenResult?.data?.jwt;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Neon Auth JWT for Railway API Bearer auth.
 * Do NOT call client.getJWTToken() — the Better Auth proxy maps it to /get-j-w-t-token (404).
 */
export async function fetchNeonAccessToken(): Promise<string | null> {
  const client = getNeonAuthClient();
  if (!client) return null;

  try {
    const cached = await readTokenFromSession(client, false);
    if (cached) return cached;
  } catch {
    /* not signed in */
  }

  try {
    const refreshed = await readTokenFromSession(client, true);
    if (refreshed) return refreshed;
  } catch {
    /* session unavailable */
  }

  try {
    return await readTokenFromTokenEndpoint(client);
  } catch {
    return null;
  }
}
