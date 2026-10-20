import { useState } from "react";
import App from "../App";
import { Button } from "./ui";
import "./sample-workspace.css";

export function sampleUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("guide");
  url.searchParams.set("sample", "1");
  return url.pathname + url.search;
}

export function SampleLink() {
  return (
    <a
      className="sample-entry"
      href={sampleUrl()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Try sample workspace (opens a new tab)"
    >
      Try sample workspace <span aria-hidden="true">↗</span>
    </a>
  );
}

export function SampleWorkspace() {
  const [visit, setVisit] = useState(0);
  const savedUrl = new URL(window.location.href);
  savedUrl.searchParams.delete("sample");
  const guideUrl = new URL(window.location.href);
  guideUrl.searchParams.set("guide", "first-plan");
  return (
    <App
      key={visit}
      sample
      banner={
        <section
          className="sample-banner"
          aria-label="Sample workspace"
          role="region"
        >
          <div>
            <strong>Sample workspace · fictional data</strong>
            <p>
              Try changes freely. Your saved planner is separate. Sample edits
              reset when you refresh, close, or leave the sample.
            </p>
          </div>
          <nav aria-label="Sample controls">
            <a
              href={guideUrl.pathname + guideUrl.search}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="First-plan walkthrough (opens a new tab)"
            >
              First-plan walkthrough <span aria-hidden="true">↗</span>
            </a>
            <Button
              variant="outline"
              onPress={() => {
                if (
                  confirm(
                    "Reset the sample? All sample edits and open drafts will be discarded. Your saved planner will not change.",
                  )
                )
                  setVisit((value) => value + 1);
              }}
            >
              Reset sample
            </Button>
            <a href={savedUrl.pathname + savedUrl.search}>
              Open my saved planner
            </a>
          </nav>
        </section>
      }
    />
  );
}
