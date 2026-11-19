// Date helpers shared by the BOM/Admin rule forms. Kept dependency-free so unit tests can import
// them with plain Node (no Vite alias, no UI imports).
export function bomFutureDate(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// `YYYY-MM-DD` in the form → the UTC instant the backend expects.
export function toInstant(dateStr) {
  return dateStr ? new Date(`${dateStr}T00:00:00.000Z`).toISOString() : undefined;
}

// Backend instant → `YYYY-MM-DD` for inputs and tables.
export function fromInstant(value) {
  return value ? String(value).slice(0, 10) : "";
}
