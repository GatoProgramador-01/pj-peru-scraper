import { describe, it, expect } from 'vitest';
import { absorbCookies, cookieHeader } from '../../src/session/cookies.js';
import type { Session } from '../../src/models/internalTypes.js';

/** Minimal Session stub — absorbCookies and cookieHeader only touch `cookies`. */
const makeSession = (): Pick<Session, 'cookies'> & { cookies: Map<string, string> } => ({
  cookies: new Map<string, string>(),
});

describe('absorbCookies', () => {
  it('parses a single-string Set-Cookie header', () => {
    const session = makeSession();
    absorbCookies(session as Session, 'JSESSIONID=abc123; Path=/; HttpOnly');
    expect(session.cookies.get('JSESSIONID')).toBe('abc123');
  });

  it('parses an array of Set-Cookie headers', () => {
    const session = makeSession();
    absorbCookies(session as Session, [
      'JSESSIONID=abc123; Path=/',
      'TOKEN=xyz789; HttpOnly',
    ]);
    expect(session.cookies.get('JSESSIONID')).toBe('abc123');
    expect(session.cookies.get('TOKEN')).toBe('xyz789');
  });

  it('handles undefined header gracefully (no cookies absorbed)', () => {
    const session = makeSession();
    absorbCookies(session as Session, undefined);
    expect(session.cookies.size).toBe(0);
  });

  it('ignores cookie strings without "=" (no name-value pair)', () => {
    const session = makeSession();
    absorbCookies(session as Session, 'BADCOOKIE; Path=/');
    expect(session.cookies.size).toBe(0);
  });

  it('ignores cookie string where "=" is at position 0 (empty name)', () => {
    const session = makeSession();
    // eqIdx must be > 0 per implementation
    absorbCookies(session as Session, '=novaluename; Path=/');
    expect(session.cookies.size).toBe(0);
  });

  it('trims whitespace from name and value', () => {
    const session = makeSession();
    absorbCookies(session as Session, '  SESSID = trimmed  ; Path=/');
    expect(session.cookies.get('SESSID')).toBe('trimmed');
  });

  it('overwrites existing cookie with same name', () => {
    const session = makeSession();
    absorbCookies(session as Session, 'TOKEN=first; Path=/');
    absorbCookies(session as Session, 'TOKEN=second; Path=/');
    expect(session.cookies.get('TOKEN')).toBe('second');
    expect(session.cookies.size).toBe(1);
  });

  it('handles cookie value containing "=" characters', () => {
    const session = makeSession();
    // Base64 values often contain "="
    absorbCookies(session as Session, 'VIEWSTATE=abc==; Path=/');
    expect(session.cookies.get('VIEWSTATE')).toBe('abc==');
  });

  it('absorbs multiple cookies from an array and skips invalid entries', () => {
    const session = makeSession();
    absorbCookies(session as Session, [
      'GOOD=value1; Path=/',
      'NOBADCOOKIE',              // no "=" → skipped
      'ALSO_GOOD=value2; Path=/',
    ]);
    expect(session.cookies.get('GOOD')).toBe('value1');
    expect(session.cookies.get('ALSO_GOOD')).toBe('value2');
    expect(session.cookies.size).toBe(2);
  });
});

describe('cookieHeader', () => {
  it('returns empty string when no cookies are set', () => {
    const session = makeSession();
    expect(cookieHeader(session as Session)).toBe('');
  });

  it('serializes a single cookie as "key=value"', () => {
    const session = makeSession();
    session.cookies.set('JSESSIONID', 'abc123');
    expect(cookieHeader(session as Session)).toBe('JSESSIONID=abc123');
  });

  it('joins multiple cookies with "; "', () => {
    const session = makeSession();
    session.cookies.set('A', '1');
    session.cookies.set('B', '2');
    expect(cookieHeader(session as Session)).toBe('A=1; B=2');
  });

  it('preserves insertion order from the Map', () => {
    const session = makeSession();
    session.cookies.set('FIRST', 'alpha');
    session.cookies.set('SECOND', 'beta');
    session.cookies.set('THIRD', 'gamma');
    expect(cookieHeader(session as Session)).toBe('FIRST=alpha; SECOND=beta; THIRD=gamma');
  });

  it('round-trips absorbed cookies back into a header', () => {
    const session = makeSession();
    absorbCookies(session as Session, [
      'JSESSIONID=sess99; Path=/',
      'TOKEN=tok42; HttpOnly',
    ]);
    const header = cookieHeader(session as Session);
    expect(header).toBe('JSESSIONID=sess99; TOKEN=tok42');
  });
});
