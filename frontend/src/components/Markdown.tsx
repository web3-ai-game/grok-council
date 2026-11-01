import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import "highlight.js/styles/github-dark.css";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            const value = String(children).replace(/\n$/, "");
            const match = /language-(\w+)/.exec(className ?? "");
            const inline = !match && !value.includes("\n");
            if (inline) {
              return <code>{value}</code>;
            }
            return <CodeBlock language={match?.[1]} value={value} />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
