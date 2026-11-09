import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import userApi from "@/api/userApi";
import { profileFromResponse, saveSessionUser, useAuthSession } from "@/lib/authSession";
import { reviewError as apiErrorMessage } from "@/lib/facilityReview";
import { Button, Message, Panel } from "@/components/manager/ManagerUI";
import { ROLE_HOME, ROLE_LABELS } from "@/lib/roles";

// Guard for the ADMIN (/admin/*) and BOM (/bom/*) workspaces, mirroring
// FacilitySessionGate for /staff and /manager. The cached role is never trusted on its own:
// GET /users/me decides, and the backend still authorises every API call afterwards.
export default function RoleGate({ role, children }) {
  const { accessToken } = useAuthSession();
  const location = useLocation();
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setResult(null);
    userApi
      .getMe({ signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const user = profileFromResponse(response);
        saveSessionUser(user);
        setResult({ token: accessToken, user });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ token: accessToken, error: apiErrorMessage(error, "Unable to verify your session.") });
      });
    return () => controller.abort();
  }, [accessToken, attempt]);

  if (!accessToken) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (result?.token !== accessToken)
    return (
      <p role="status" className="p-8">
        Verifying your session…
      </p>
    );
  if (result.error)
    return (
      <Panel title="Session verification failed">
        <Message error={result.error} />
        <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
      </Panel>
    );

  if (result.user.role !== role) {
    const home = ROLE_HOME[result.user.role];
    // Known roles go back to their own workspace instead of seeing an empty shell.
    if (home && !location.pathname.startsWith(home.split("/")[1] ? `/${home.split("/")[1]}/` : home))
      return <Navigate to={home} replace />;
    return (
      <Panel title="Access denied">
        <p role="alert">
          This workspace requires the {ROLE_LABELS[role] || role} role. Your account role is{" "}
          {ROLE_LABELS[result.user.role] || "not supported"}.
        </p>
      </Panel>
    );
  }

  return children;
}
