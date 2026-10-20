import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import firstPlan from "../../docs/first-plan.md?raw";
import installation from "../../docs/download-and-install.md?raw";
import { sampleUrl } from "./SampleWorkspace";
import "./sample-workspace.css";

export function BeginnerGuide({ install = false }: { install?: boolean }) {
  const url = new URL(window.location.href);
  url.searchParams.delete("guide");
  const back = url.pathname + url.search;
  const guideUrl = (name: string) => {
    const link = new URL(window.location.href);
    link.searchParams.set("guide", name);
    return link.pathname + link.search;
  };
  return (
    <main className="beginner-guide">
      <nav aria-label="Guide navigation">
        <a href={back}>
          {url.searchParams.get("sample") === "1"
            ? "Back to sample"
            : "Back to planner"}
        </a>
        <a href={sampleUrl()} target="_blank" rel="noopener noreferrer">
          Try sample in a new tab
        </a>
        <a href={guideUrl(install ? "first-plan" : "install")}>
          {install ? "First-plan walkthrough" : "Download and installation"}
        </a>
      </nav>
      <article>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ src, alt }) => (
              <img
                src={src?.replace("../public/guide/", "/guide/")}
                alt={alt}
              />
            ),
            a: ({ href, children }) => {
              if (href === "first-plan.md")
                return <a href={guideUrl("first-plan")}>{children}</a>;
              if (href === "download-and-install.md")
                return <a href={guideUrl("install")}>{children}</a>;
              // The full manual accompanies the source download; it has no published URL yet.
              if (href?.startsWith("user-manual.md"))
                return (
                  <span>{children} (included with the source download)</span>
                );
              return <a href={href}>{children}</a>;
            },
          }}
        >
          {install ? installation : firstPlan}
        </ReactMarkdown>
      </article>
    </main>
  );
}
