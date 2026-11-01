import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../lib/api";

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await register(username, password);
      } else {
        await login(username, password);
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page auth">
      <h1>OECE-X Heavy</h1>
      <p className="sub">登录后隔离各自的聊天记录 · 热开发</p>
      <form onSubmit={onSubmit} className="card">
        <label>
          用户名
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {mode === "login" ? "登录" : "注册"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
        </button>
      </form>
    </main>
  );
}
