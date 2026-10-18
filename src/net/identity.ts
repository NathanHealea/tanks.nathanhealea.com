// Deliberately never stored: a reload is a new player, so no id outlives the page or links two visits.
const id = crypto.randomUUID();

export function playerId(): string {
  return id;
}
