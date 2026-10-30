import { useState } from "react";
import hljs from "highlight.js";

type Props = {
  language?: string;
  value: string;
};

export function CodeBlock({ language, value }: Props) {
  const [copied, setCopied] = useState(false);
  const highlighted = (() => {
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(value, { language }).value;
      }
      return hljs.highlightAuto(value).value;
    } catch {
      return value;
    }
  })();

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="code-wrap">
      <button type="button" className="copy" onClick={() => void copy()}>
        {copied ? "已复制" : "复制"}
      </button>
      <pre>
        <code
          className={language ? `hljs language-${language}` : "hljs"}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
