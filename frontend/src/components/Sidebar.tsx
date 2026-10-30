import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteChat, patchChat } from "../lib/api";
import type { Chat, User } from "../lib/types";

function dayKey(iso: string): "today" | "yesterday" | "week" | "older" {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (t >= start.getTime()) return "today";
  if (t >= start.getTime() - 86400000) return "yesterday";
  if (now - t < 7 * 86400000) return "week";
  return "older";
}

const LABELS = { today: "今天", yesterday: "昨天", week: "近 7 天", older: "更早" };

export function Sidebar({
  user,
  chats,
  chatId,
  collapsed,
  onNew,
  onLogout,
  onReload,
  onSearch,
}: {
  user: User | null;
  chats: Chat[];
  chatId?: string;
  collapsed: boolean;
  onNew: () => void;
  onLogout: () => void;
  onReload: () => Promise<void>;
  onSearch: (q: string) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const pinned = chats.filter((c) => c.pinned);
    const rest = chats.filter((c) => !c.pinned);
    const buckets: Record<string, Chat[]> = { today: [], yesterday: [], week: [], older: [] };
    for (const chat of rest) buckets[dayKey(chat.updated_at)]?.push(chat);
    return { pinned, buckets };
  }, [chats]);

  async function rename(id: string, title: string) {
    const next = window.prompt("重命名", title);
    if (!next?.trim()) return;
    await patchChat(id, { title: next.trim() });
    await onReload();
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="side-head">
        <strong>聊天</strong>
        <button type="button" className="side-new" onClick={onNew} title="新對話 ⌘⇧O" aria-label="新對話">
          +
        </button>
      </div>
      {!collapsed ? (
        <input
          className="search"
          placeholder="篩選對話"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onSearch(e.target.value);
          }}
        />
      ) : null}
      <nav className="chat-list">
        {grouped.pinned.length ? (
          <p className="side-label">{collapsed ? "★" : "固定"}</p>
        ) : null}
        {grouped.pinned.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            active={chat.id === chatId}
            collapsed={collapsed}
            open={menuId === chat.id}
            onMenu={() => setMenuId(menuId === chat.id ? null : chat.id)}
            onRename={() => void rename(chat.id, chat.title)}
            onPin={() => void patchChat(chat.id, { pinned: false }).then(onReload)}
            onDelete={() =>
              void deleteChat(chat.id).then(async () => {
                await onReload();
                if (chat.id === chatId) navigate("/");
              })
            }
          />
        ))}
        {(["today", "yesterday", "week", "older"] as const).map((key) =>
          grouped.buckets[key]?.length ? (
            <section key={key}>
              {!collapsed ? <p className="side-label">{LABELS[key]}</p> : null}
              {grouped.buckets[key].map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === chatId}
                  collapsed={collapsed}
                  open={menuId === chat.id}
                  onMenu={() => setMenuId(menuId === chat.id ? null : chat.id)}
                  onRename={() => void rename(chat.id, chat.title)}
                  onPin={() => void patchChat(chat.id, { pinned: true }).then(onReload)}
                  onDelete={() =>
                    void deleteChat(chat.id).then(async () => {
                      await onReload();
                      if (chat.id === chatId) navigate("/");
                    })
                  }
                />
              ))}
            </section>
          ) : null,
        )}
      </nav>
      {!collapsed ? (
        <div className="side-foot">
          <span className="muted">{user?.username}</span>
          <button type="button" className="link" onClick={onLogout}>
            退出
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function ChatRow({
  chat,
  active,
  collapsed,
  open,
  onMenu,
  onRename,
  onPin,
  onDelete,
}: {
  chat: Chat;
  active: boolean;
  collapsed: boolean;
  open: boolean;
  onMenu: () => void;
  onRename: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`chat-row ${active ? "active" : ""}`}>
      <Link to={`/c/${chat.id}`} title={chat.title}>
        {collapsed ? chat.title.slice(0, 1) : chat.title}
      </Link>
      {!collapsed ? (
        <button type="button" className="link row-menu" onClick={onMenu} aria-label="会话操作">
          ⋯
        </button>
      ) : null}
      {open ? (
        <div className="row-pop">
          <button type="button" className="link" onClick={onRename}>
            重命名
          </button>
          <button type="button" className="link" onClick={onPin}>
            {chat.pinned ? "取消置顶" : "置顶"}
          </button>
          <button type="button" className="link" onClick={onDelete}>
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
