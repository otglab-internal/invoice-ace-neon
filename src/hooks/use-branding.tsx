import { useEffect, useState } from "react";
import { neonQuery } from "@/lib/neon-client";

interface Branding {
  logoUrl: string | null;
  faviconUrl: string | null;
  loading: boolean;
}

let cachedBranding: { logoUrl: string | null; faviconUrl: string | null } | null = null;

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>({
    logoUrl: cachedBranding?.logoUrl ?? null,
    faviconUrl: cachedBranding?.faviconUrl ?? null,
    loading: !cachedBranding,
  });

  useEffect(() => {
    if (cachedBranding) return;

    const fetch = async () => {
      const { data } = await neonQuery<{ key: string; value: string }>("global_config", {
        select: "key,value",
        filters: { key: ["logo_url", "favicon_url"] },
      });

      const map: Record<string, string> = {};
      if (Array.isArray(data)) {
        data.forEach((r) => (map[r.key] = r.value));
      }

      const result = { logoUrl: map["logo_url"]?.trim() || null, faviconUrl: map["favicon_url"]?.trim() || null };
      cachedBranding = result;
      setBranding({ ...result, loading: false });

      // Apply favicon
      if (result.faviconUrl) {
        let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          document.head.appendChild(link);
        }
        link.href = result.faviconUrl;
      }
    };

    fetch();
  }, []);

  return branding;
}

/** Reset cache (e.g. after saving new branding in GlobalConfig) */
export function invalidateBrandingCache() {
  cachedBranding = null;
}
