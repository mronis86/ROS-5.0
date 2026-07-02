import { createAuthClient } from '@neondatabase/neon-js/auth';

const neonAuthUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined)?.trim();

export const isNeonAuthEnabled = Boolean(neonAuthUrl);

export function getNeonAuthBaseUrl(): string | null {
  if (!neonAuthUrl) return null;
  return neonAuthUrl.replace(/\/$/, '');
}

type NeonAuthClient = ReturnType<typeof createAuthClient>;

let cachedClient: NeonAuthClient | null = null;

export function getNeonAuthClient(): NeonAuthClient | null {
  if (!neonAuthUrl) return null;
  if (!cachedClient) {
    cachedClient = createAuthClient(neonAuthUrl);
  }
  return cachedClient;
}

/** Three-part token shape (JWT or Better Auth signed session cookie). */
export function isJwtFormat(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/** True only for Neon Auth EdDSA JWTs from authClient.token() — not signed session cookies. */
export function isNeonAuthJwt(token: string): boolean {
  if (!isJwtFormat(token)) return false;
  try {
    const headerB64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const padded = headerB64 + '='.repeat((4 - (headerB64.length % 4)) % 4);
    const header = JSON.parse(atob(padded)) as { alg?: string };
    return header.alg === 'EdDSA' || header.alg === 'Ed25519';
  } catch {
    return false;
  }
}

type SessionLike = { token?: string; access_token?: string } | null | undefined;

function readJwtFromSession(session: SessionLike): string | null {
  if (!session) return null;
  const candidates = [session.token, session.access_token];
  for (const value of candidates) {
    if (typeof value === 'string' && value && isNeonAuthJwt(value)) return value;
  }
  return null;
}

export function extractTokenFromAuthResult(result: unknown): string | null {
  const data = (result as { data?: { session?: SessionLike } })?.data;
  return readJwtFromSession(data?.session);
}

async function readJwtFromTokenEndpoint(client: NeonAuthClient): Promise<string | null> {
  if (typeof client.token !== 'function') return null;
  const tokenResult = await client.token();
  const value = tokenResult?.data?.token ?? tokenResult?.data?.access_token ?? tokenResult?.data?.jwt;
  if (typeof value === 'string' && value && isNeonAuthJwt(value)) return value;
  return null;
}

async function readJwtFromSessionFetch(client: NeonAuthClient, forceFetch: boolean): Promise<string | null> {
  let jwtFromHeader: string | null = null;
  const sessionResult = await client.getSession(
    forceFetch
      ? {
          fetchOptions: {
            headers: { 'X-Force-Fetch': 'true' },
            onSuccess: (ctx: { response: Response }) => {
              const headerJwt = ctx.response.headers.get('set-auth-jwt');
              if (headerJwt && isNeonAuthJwt(headerJwt)) jwtFromHeader = headerJwt;
            },
          },
        }
      : undefined
  );

  if (jwtFromHeader) return jwtFromHeader;
  return readJwtFromSession(sessionResult.data?.session);
}

export type NeonAuthCredentials = {
  jwt: string | null;
  sessionToken: string | null;
  signedSessionToken: string | null;
};

function readAuthHeaders(ctx: { response: Response }): Pick<NeonAuthCredentials, 'jwt' | 'signedSessionToken'> {
  const headerJwt = ctx.response.headers.get('set-auth-jwt');
  const headerSession = ctx.response.headers.get('set-auth-token');
  return {
    jwt: headerJwt && isNeonAuthJwt(headerJwt) ? headerJwt : null,
    signedSessionToken: headerSession || null,
  };
}

/** Collect JWT + signed session token from Neon (response headers are authoritative). */
export async function collectNeonAuthCredentials(): Promise<NeonAuthCredentials> {
  const client = getNeonAuthClient();
  if (!client) return { jwt: null, sessionToken: null, signedSessionToken: null };

  let jwt: string | null = null;
  let signedSessionToken: string | null = null;
  let sessionToken: string | null = null;

  try {
    await client.getSession({
      fetchOptions: {
        headers: { 'X-Force-Fetch': 'true' },
        onSuccess: (ctx) => {
          const headers = readAuthHeaders(ctx);
          jwt = headers.jwt;
          signedSessionToken = headers.signedSessionToken;
        },
      },
    });
  } catch {
    /* ignore */
  }

  if (!jwt) {
    try {
      jwt = await fetchNeonAccessToken();
    } catch {
      /* ignore */
    }
  }

  try {
    const sessionResult = await client.getSession();
    const raw = sessionResult.data?.session?.token ?? null;
    if (raw) {
      if (isNeonAuthJwt(raw)) jwt = jwt || raw;
      else sessionToken = raw;
    }
  } catch {
    /* ignore */
  }

  return { jwt, sessionToken, signedSessionToken };
}

/**
 * Cross-domain Railway API auth requires a Neon JWT from authClient.token().
 */
export async function fetchNeonAccessToken(): Promise<string | null> {
  const client = getNeonAuthClient();
  if (!client) return null;

  try {
    const fromTokenEndpoint = await readJwtFromTokenEndpoint(client);
    if (fromTokenEndpoint) return fromTokenEndpoint;
  } catch {
    /* not signed in or token endpoint unavailable */
  }

  try {
    const fromSession = await readJwtFromSessionFetch(client, true);
    if (fromSession) return fromSession;
  } catch {
    /* no session */
  }

  return null;
}
