const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True only for a lowercase RFC 4122 version 4 UUID, exactly what `crypto.randomUUID()` produces; one canonical form keeps index lookups from seeing one player as two. */
export function isPlayerId(value: string): boolean {
  return V4_UUID.test(value);
}
