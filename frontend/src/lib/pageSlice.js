// Client-side paging for the collections the backend still returns whole (users, customers,
// notifications, per-account audit/login history). Those endpoints have no page/limit contract, so
// the page is sliced in the browser instead of pretending the API paginates.
export const PAGE_SIZE = 20;

export function pageSlice(rows = [], page = 1, pageSize = PAGE_SIZE) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (current - 1) * pageSize;
  return {
    rows: list.slice(start, start + pageSize),
    total,
    totalPages,
    page: current,
    start,
    end: start + pageSize,
  };
}

export default pageSlice;
