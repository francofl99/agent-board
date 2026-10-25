import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Rail } from "./Rail";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has("rail") || "__TAURI__" in window ? <Rail /> : <App />}
  </StrictMode>
);
