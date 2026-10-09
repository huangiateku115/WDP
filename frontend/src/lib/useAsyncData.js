import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/apiError";

// Small async loader hook for the live BOM pages.
export function useAsyncData(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null, error: "" });
    Promise.resolve()
      .then(loader)
      .then(
        (data) => { if (alive) setState({ loading: false, data, error: "" }); },
        (err) => { if (alive) setState({ loading: false, data: null, error: apiErrorMessage(err) }); },
      );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
