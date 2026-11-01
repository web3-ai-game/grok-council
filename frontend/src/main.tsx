import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./demo.css";

const demoMode = import.meta.env.MODE === "demo";
if (demoMode) {
  document.documentElement.classList.add("lights-app");
} else {
  await import("./styles.css");
  const { initTheme } = await import("./lib/store");
  initTheme();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing");
}

const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={basename || undefined}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
