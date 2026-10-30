import { type ReactNode, lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { fetchMe } from "./lib/api";
import type { User } from "./lib/types";
import { Login } from "./routes/Login";

const Chat = lazy(() => import("./routes/Chat").then((m) => ({ default: m.Chat })));
const Imagine = lazy(() => import("./routes/Imagine").then((m) => ({ default: m.Imagine })));
const Projects = lazy(() => import("./routes/Projects").then((m) => ({ default: m.Projects })));
const Settings = lazy(() =>
  import("./routes/Settings").then((m) => ({ default: m.Settings })),
);
const Tasks = lazy(() => import("./routes/Tasks").then((m) => ({ default: m.Tasks })));

function Guard({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user === undefined) {
    return <main className="page">加载中…</main>;
  }
  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<main className="page">加载中…</main>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Guard><Chat /></Guard>} />
        <Route path="/c/:chatId" element={<Guard><Chat /></Guard>} />
        <Route path="/imagine" element={<Guard><Imagine /></Guard>} />
        <Route path="/projects" element={<Guard><Projects /></Guard>} />
        <Route path="/tasks" element={<Guard><Tasks /></Guard>} />
        <Route path="/settings" element={<Guard><Settings /></Guard>} />
      </Routes>
    </Suspense>
  );
}
