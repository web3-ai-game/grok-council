import type { Citation } from "../lib/types";

export function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  return (
    <ul className="citations">
      {items.map((item) => (
        <li key={item.url}>
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title || item.url}
          </a>
        </li>
      ))}
    </ul>
  );
}
