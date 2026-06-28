import type { Session } from '../models/internalTypes.js';

/**
 * Parses Set-Cookie response headers and stores name=value pairs in the session.
 * axios does not persist cookies across requests, so we maintain our own jar.
 * The portal uses JSESSIONID and ViewState-linked cookies that must survive
 * the full GET → POST search → paginate sequence.
 */
export const absorbCookies = (session: Session, setCookieHeader: string[] | string | undefined): void => {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader
    : setCookieHeader ? [setCookieHeader] : [];
  for (const raw of headers) {
    const [nameVal] = raw.split(';');
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx > 0) {
      session.cookies.set(nameVal.slice(0, eqIdx).trim(), nameVal.slice(eqIdx + 1).trim());
    }
  }
};

/** Serializes the session cookie jar into the Cookie: request header format. */
export const cookieHeader = (session: Session): string =>
  [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
