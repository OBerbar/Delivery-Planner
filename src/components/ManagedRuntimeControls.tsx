import { useEffect, useRef, useState } from "react";
import { Power } from "lucide-react";
import { Button, ErrorText } from "./ui";
import "./local-runtime.css";

export function ManagedRuntimeControls() {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("desktop") !== "1")
      return;
    let active = true;
    void fetch("/api/runtime")
      .then((response) => {
        if (!response.ok) throw new Error("Runtime controls are unavailable.");
        return response.json();
      })
      .then((value) => {
        if (active && value.managed && typeof value.quitToken === "string")
          setToken(value.quitToken);
      })
      .catch(() => {
        /* Source edition and stopped servers have no managed controls. */
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!stopped) return;
    const app = document.getElementById("planner-app");
    if (app) app.inert = true;
    heading.current?.focus();
  }, [stopped]);
  if (!token) return null;
  if (stopped)
    return (
      <section className="managed-runtime-stopped" aria-live="polite">
        <h1 ref={heading} tabIndex={-1}>
          Delivery Studio stopped
        </h1>
        <p>
          Your saved workspace stays on this computer. Close this browser tab
          and open Delivery Studio again when you need it.
        </p>
      </section>
    );
  return (
    <aside
      className="managed-runtime-control"
      aria-label="Local application controls"
    >
      <ErrorText text={error} />
      <Button
        variant="outline"
        isPending={pending}
        onPress={async () => {
          if (
            !confirm(
              "Quit Delivery Studio? Finish saving first. Unsaved forms and What-if experiments will be discarded.",
            )
          )
            return;
          setPending(true);
          setError("");
          try {
            const response = await fetch("/api/quit", {
              method: "POST",
              headers: { "x-delivery-studio-token": token },
            });
            if (!response.ok || !(await response.json()).stopping)
              throw new Error(
                "The application could not confirm that it stopped. Try again.",
              );
            let closed = false;
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
              await new Promise((done) => setTimeout(done, 150));
              try {
                await fetch("/api/health", {
                  cache: "no-store",
                  signal: AbortSignal.timeout(1000),
                });
              } catch (healthError) {
                // A timeout alone does not prove shutdown; connection failure does.
                if (
                  healthError instanceof Error &&
                  healthError.name === "TimeoutError"
                )
                  continue;
                closed = true;
                break;
              }
            }
            if (!closed)
              throw new Error(
                "Delivery Studio is still running. Try quitting again.",
              );
            setStopped(true);
          } catch (value) {
            setError(
              value instanceof Error
                ? value.message
                : "Unable to quit. Try again.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <Power size={16} />
        Quit Delivery Studio
      </Button>
    </aside>
  );
}
