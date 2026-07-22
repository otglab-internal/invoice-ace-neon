import { useEffect, useState } from "react";
import { neonQuery } from "@/lib/neon-client";

interface Branding {
  logoUrl: string | null;
  faviconUrl: string | null;
  companyName: string | null;
  companySsm: string | null;
  companyAddress: string | null;
  loading: boolean;
}

type BrandingData = {
  logoUrl: string | null;
  faviconUrl: string | null;
  companyName: string | null;
  companySsm: string | null;
  companyAddress: string | null;
};

const BRANDING_UPDATED_EVENT = "branding:updated";

let cachedBranding: BrandingData | null = null;

function applyFavicon(faviconUrl: string | null) {
  if (typeof document === "undefined" || !faviconUrl) return;

  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = faviconUrl;
}

async function fetchBranding(): Promise<BrandingData> {
  const token = localStorage.getItem("auth_token")?.trim();
  if (!token || ["undefined", "null"].includes(token.toLowerCase())) {
    return {
      logoUrl: null,
      faviconUrl: null,
      companyName: null,
      companySsm: null,
      companyAddress: null,
    };
  }

  const { data } = await neonQuery<{ key: string; value: string }>("global_config", {
    select: "key,value",
  });

  const map: Record<string, string> = {};
  if (Array.isArray(data)) {
    data.forEach((row) => {
      map[row.key] = row.value;
    });
  }

  return {
    logoUrl: map["logo_url"]?.trim() || null,
    faviconUrl: map["favicon_url"]?.trim() || null,
    companyName: map["company_name"]?.trim() || null,
    companySsm: map["company_ssm"]?.trim() || null,
    companyAddress: map["company_address"]?.trim() || null,
  };
}

function notifyBrandingUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BRANDING_UPDATED_EVENT));
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>({
    logoUrl: cachedBranding?.logoUrl ?? null,
    faviconUrl: cachedBranding?.faviconUrl ?? null,
    companyName: cachedBranding?.companyName ?? null,
    companySsm: cachedBranding?.companySsm ?? null,
    companyAddress: cachedBranding?.companyAddress ?? null,
    loading: !cachedBranding,
  });

  useEffect(() => {
    let active = true;

    const syncBranding = async () => {
      if (cachedBranding) {
        applyFavicon(cachedBranding.faviconUrl);
        if (active) {
          setBranding({ ...cachedBranding, loading: false });
        }
        return;
      }

      if (active) {
        setBranding((current) => ({ ...current, loading: true }));
      }

      const result = await fetchBranding();
      cachedBranding = result;
      applyFavicon(result.faviconUrl);

      if (active) {
        setBranding({ ...result, loading: false });
      }
    };

    const handleBrandingUpdated = () => {
      void syncBranding();
    };

    void syncBranding();
    window.addEventListener(BRANDING_UPDATED_EVENT, handleBrandingUpdated);

    return () => {
      active = false;
      window.removeEventListener(BRANDING_UPDATED_EVENT, handleBrandingUpdated);
    };
  }, []);

  return branding;
}

/** Reset cache (e.g. after saving new branding in GlobalConfig) */
export function invalidateBrandingCache(nextBranding?: BrandingData) {
  cachedBranding = nextBranding ?? null;
  if (nextBranding) {
    applyFavicon(nextBranding.faviconUrl);
  }
  notifyBrandingUpdated();
}
