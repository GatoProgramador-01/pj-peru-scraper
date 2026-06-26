import type { Session } from '../models/internalTypes.js';

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

export const cookieHeader = (session: Session): string =>
  [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
