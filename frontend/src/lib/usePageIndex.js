import { useEffect, useState } from "react";

// Shared 1-based page index for the BOM/Admin tables.
// `resetKey` describes the active filters (facility, status, search…). When it changes the list is
// re-read from page 1, so a page index that belongs to the previous filter can never request an
// out-of-range page from the backend.
export function usePageIndex(resetKey = "") {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  return [page, setPage];
}

export default usePageIndex;
