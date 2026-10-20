import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initTheme } from "./theme.ts";
// Inter (text and display), Space Grotesk (the wordmark) and Space Mono (labels and technical values), all
// OFL and bundled so they render offline and on every device (see --font in styles.css).
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/space-grotesk";
import "@fontsource/space-mono/400.css";
import "./styles.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
