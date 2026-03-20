import { createRoot } from "react-dom/client";
import { supabase } from "@/integrations/supabase/client";
import App from "./App.tsx";
import "./index.css";

// Load favicon from global_config on startup
(async () => {
  try {
    const { data } = await supabase
      .from("global_config")
      .select("value")
      .eq("key", "favicon_url")
      .limit(1);
    const url = data?.[0]?.value;
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
