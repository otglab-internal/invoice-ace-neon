export function getOrgId(): string {
  const config = (window as any).__APP_CONFIG__ || {};
  if (!config.org_id) throw new Error("org_id is not configured in config.js");
  return config.org_id;
}
