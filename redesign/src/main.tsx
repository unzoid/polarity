import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { queryClient } from "../../src/lib/net";
import { AccountProvider, startAccountBackend } from "../../src/lib/account";
import { mirrorFormFactor } from "../../src/lib/ui";
import { inShell, os } from "../../src/lib/platform";
import { App } from "./App";

import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import "./styles/home.css";
import "./styles/title.css";
import "./styles/welcome.css";

document.documentElement.dataset.os = os === "windows" ? "windows" : os === "macos" ? "mac" : os === "android" ? "android" : "other";
mirrorFormFactor(document.documentElement);

const root = createRoot(document.getElementById("root")!);

if (!inShell) {
  root.render(
    <div className="welcome">
      <p className="muted">Polarity runs inside its desktop shell. Open redesign/fake.html for the stand-in.</p>
    </div>,
  );
} else {
  await startAccountBackend().catch(() => undefined);
  root.render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <AccountProvider>
            <App />
          </AccountProvider>
        </QueryClientProvider>
      </MotionConfig>
    </StrictMode>,
  );
}
