// "Sign in with Google" using the OAuth 2.0 authorization-code flow with PKCE.
// The ID token comes straight from Google's token endpoint over HTTPS (authenticated with the
// client secret), so its claims can be trusted after checking issuer, audience and expiry.
import { createHash } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export const randomToken = (bytes = 32) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Buffer.from(a).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const challengeFor = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function authorizationUrl(cfg: GoogleConfig, redirectUri: string, state: string, verifier: string) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
}

/** Exchanges the code for tokens and returns the verified email, or throws with a short reason. */
export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  redirectUri: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleIdentity> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('no id_token in response');
  const part = body.id_token.split('.')[1];
  if (!part) throw new Error('malformed id_token');
  const claims = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('wrong issuer');
  if (claims.aud !== cfg.clientId) throw new Error('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new Error('expired token');
  if (claims.email_verified !== true || typeof claims.email !== 'string') throw new Error('email not verified by Google');
  return { email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name : null };
}
