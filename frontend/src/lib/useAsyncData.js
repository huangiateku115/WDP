import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/apiError";

// Async data hook for the live pages.
// - aborts the in-flight request when deps change or the component unmounts
// - ignores stale/aborted responses so late replies never overwrite newer state
export function useAsyncData(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ loading: true, data: null, error: "" });
    Promise.resolve()
      .then(() => loader({ signal: controller.signal }))
      .then(
        (data) => {
          if (active && !controller.signal.aborted) setState({ loading: false, data, error: "" });
        },
        (err) => {
          if (!active || controller.signal.aborted) return;
          if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
          setState({ loading: false, data: null, error: apiErrorMessage(err) });
        },
      );
    return () => { active = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
