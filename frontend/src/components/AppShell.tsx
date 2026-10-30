import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { IconRail } from "./IconRail";

export function AppShell({
  title,
  collapsed,
  sidebar,
  extraTop,
  children,
}: {
  title: string;
  collapsed?: boolean;
  sidebar?: ReactNode;
  extraTop?: ReactNode;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  return (
    <div
      className={`shell${collapsed ? " collapsed-shell" : ""}${sidebar ? "" : " no-sidebar"}${drawer ? " drawer-open" : ""}`}
    >
      {drawer ? (
        <button type="button" className="drawer-mask" aria-label="關閉側欄" onClick={() => setDrawer(false)} />
      ) : null}
      <div className={`nav-cluster${drawer ? " open" : ""}`}>
        <IconRail />
        {sidebar ? <div className="sidebar-slot">{sidebar}</div> : null}
      </div>
      <section className="thread">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="選單">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M5 7h14M5 12h14M5 17h14" />
            </svg>
          </button>
          <h2>{title}</h2>
          {extraTop}
        </header>
        {children}
      </section>
    </div>
  );
}
