import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();

export function isAuthorized(headers, token) {
  const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '');
  const candidates = [headers['x-api-key'], bearer?.[1]];
  const expected = digest(token);
  let ok = false;
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== ''
      && timingSafeEqual(digest(candidate), expected)) ok = true;
  }
  return ok;
}
