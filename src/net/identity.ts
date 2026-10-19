// Deliberately never stored: a reload is a new player, so no id outlives the page or links two visits.
const id = randomV4Uuid();

export function playerId(): string {
  return id;
}

// crypto.randomUUID exists only on HTTPS and localhost, but phones test the dev server over plain http on the LAN;
// getRandomValues works in any context, so build the same lowercase v4 UUID from it.
function randomV4Uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
