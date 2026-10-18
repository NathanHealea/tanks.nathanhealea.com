const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True only for an RFC 4122 version 4 UUID, the shape `crypto.randomUUID()` produces. */
export function isPlayerId(value: string): boolean {
  return V4_UUID.test(value);
}
