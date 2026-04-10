import { neonInsert } from "@/lib/neon-client";

export type ActivityCategory = "config" | "template" | "staff" | "settings" | "system" | "invoice" | "email";

export async function logActivity(
  actionType: string,
  category: ActivityCategory,
  performedBy: string,
  performedByName: string,
  details: Record<string, any> = {}
): Promise<void> {
  try {
    await neonInsert("activity_logs", {
      action_type: actionType,
      category,
      performed_by: performedBy,
      performed_by_name: performedByName,
      details: JSON.parse(JSON.stringify(details)),
    });
  } catch (err) {
    console.warn("Failed to write activity log:", err);
  }
}
