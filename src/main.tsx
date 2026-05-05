import { createRoot } from "react-dom/client";
import { neonQuery } from "@/lib/neon-client";
import { patchFunctionsInvoke } from "@/lib/patch-functions-invoke";
import App from "./App.tsx";
import "./index.css";

// Globally rewrite "Edge Function returned a non-2xx status code" into the
// real message returned by the edge function body.
patchFunctionsInvoke();

// Load favicon from global_config on startup
(async () => {
  try {
    const { data } = await neonQuery("global_config", {
      select: "value",
      filters: { key: "favicon_url" },
      maybeSingle: true,
    });
    const url = (data as any)?.value;
    if (url) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = url;
    }
  } catch {
    // ignore favicon load errors
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
