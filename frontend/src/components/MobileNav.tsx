import { NavLink } from "react-router-dom";

export function MobileNav() {
  return (
    <nav className="mobile-nav">
      <NavLink to="/" end>
        对话
      </NavLink>
      <NavLink to="/imagine">创作</NavLink>
      <NavLink to="/projects">项目</NavLink>
      <NavLink to="/tasks">任务</NavLink>
      <NavLink to="/settings">设置</NavLink>
    </nav>
  );
}
