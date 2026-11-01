import { NavLink, useLocation } from "react-router-dom";

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M5 7.2A2.2 2.2 0 0 1 7.2 5h9.6A2.2 2.2 0 0 1 19 7.2v7.1a2.2 2.2 0 0 1-2.2 2.2H9.2L5 20v-3.4A2.2 2.2 0 0 1 5 14.3z" />
    </svg>
  );
}

function IconImagine() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2.2" />
      <path d="M4 15.5 9 11l3.5 3.5L16 11l4 4" />
      <circle cx="9" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconProjects() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 8.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5" />
      <path d="M4 8.5 6.2 5h4.1l1.4 1.8H18a2 2 0 0 1 2 2v.7H4z" />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="5" y="5" width="14" height="15" rx="2.2" />
      <path d="M8 3.5v3M16 3.5v3M5 9.5h14" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v1.6M12 17.9v1.6M4.5 12h1.6M17.9 12h1.6M6.4 6.4l1.1 1.1M16.5 16.5l1.1 1.1M17.6 6.4l-1.1 1.1M7.5 16.5l-1.1 1.1" />
    </svg>
  );
}

const ITEMS = [
  { to: "/", label: "對話", icon: <IconChat />, match: "chat" as const },
  { to: "/imagine", label: "Imagine", icon: <IconImagine />, match: "path" as const },
  { to: "/projects", label: "專案", icon: <IconProjects />, match: "path" as const },
  { to: "/tasks", label: "任務", icon: <IconTasks />, match: "path" as const },
] as const;

export function IconRail() {
  const location = useLocation();
  const chatOn = location.pathname === "/" || location.pathname.startsWith("/c/");

  return (
    <nav className="icon-rail" aria-label="主導覽">
      <div className="rail-top">
        {ITEMS.map((item) => {
          const className = ({ isActive }: { isActive: boolean }) =>
            `rail-btn${item.match === "chat" ? (chatOn ? " active" : "") : isActive ? " active" : ""}`;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={className} title={item.label}>
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
      <NavLink to="/settings" className={({ isActive }) => `rail-btn${isActive ? " active" : ""}`} title="設置">
        <IconSettings />
        <span>設置</span>
      </NavLink>
    </nav>
  );
}
