import { useEffect, useState } from "react";

// Project UI convention (UI_BUG_LOG.md — quy ước 2): a free-text filter that triggers a request
// must be debounced (~350ms) so typing does not fire one call per keystroke.
export const FILTER_DEBOUNCE_MS = 350;

export function useDebouncedValue(value, delay = FILTER_DEBOUNCE_MS) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
