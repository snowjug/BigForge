import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface SessionClaims {
  sub: string;
  tenant: string;
  role: string;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/** Compact HMAC-signed session token: base64url(claims).base64url(hmac-sha256). */
export function signSession(claims: SessionClaims, secret: string): string {
  const body = b64(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(
  token: string,
  secret: string,
  nowSeconds: number,
): SessionClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as Partial<SessionClaims>;
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.tenant !== 'string' ||
      typeof claims.role !== 'string' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= nowSeconds
    ) {
      return null;
    }
    return { sub: claims.sub, tenant: claims.tenant, role: claims.role, exp: claims.exp };
  } catch {
    return null;
  }
}
