import { createRoot } from "react-dom/client";
import App from "./App";
import { ManagedRuntimeControls } from "./components/ManagedRuntimeControls";
import { SampleWorkspace } from "./components/SampleWorkspace";
import { BeginnerGuide } from "./components/BeginnerGuide";
import { isSampleWorkspace } from "./lib/sample-workspace";
import "./styles.css";
const sample = isSampleWorkspace();
const guide = new URLSearchParams(window.location.search).get("guide");
createRoot(document.getElementById("root")!).render(
  <>
    <div id="planner-app">
      {guide === "first-plan" || guide === "install" ? (
        <BeginnerGuide install={guide === "install"} />
      ) : sample ? (
        <SampleWorkspace />
      ) : (
        <App />
      )}
    </div>
    {!sample && <ManagedRuntimeControls />}
  </>,
);
