import React, { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ExternalUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  country: string;
  company_roles?: string[];
}

interface TagRecord {
  id: string;
  system_id: string;
  tags: string[];
  centre_locations: string[];
}

/** Merged view of an external user + their local tag record (if any) */
interface StaffRow {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  companyRoles: string[];
  country: string;
  tags: string[];
  centreLocations: string[];
  tagRecordId: string | null;
}

const CENTRE_LOCATIONS = [
  "KL Center",
  "PJ Center",
  "JB Center",
  "Penang Center",
  "Ipoh Center",
];

const AllStaffPage: React.FC = () => {
  const { user, environment } = useAuth();
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const env = environment || "production";
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const usersRes = await fetch(
        `https://${projectId}.supabase.co/functions/v1/get-users-proxy?environment=${env}`,
        {
          method: "GET",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
          },
        }
      );

      if (!usersRes.ok) {
        throw new Error("Failed to fetch users");
      }

      const usersData = await usersRes.json();
      const externalUsers: ExternalUser[] = usersData.data || [];

      const { data: tagRecords, error: tagError } = await supabase
        .from("staff_centre_assignments")
        .select("id, system_id, tags, centre_locations");

      if (tagError) {
        toast.error("Failed to load tag records");
      }

      const tagMap = new Map<string, TagRecord>();
      ((tagRecords as any[]) || []).forEach((r) => {
        tagMap.set(r.system_id, {
          id: r.id,
          system_id: r.system_id,
          tags: r.tags || [],
          centre_locations: r.centre_locations || [],
        });
      });

      const merged: StaffRow[] = externalUsers.map((u) => {
        const tag = tagMap.get(u.id);
        return {
          userId: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          email: u.email,
          role: u.role,
          companyRoles: u.company_roles || [],
          country: u.country,
          tags: tag?.tags || [],
          centreLocations: tag?.centre_locations || [],
          tagRecordId: tag?.id || null,
        };
      });

      setStaffRows(merged);
    } catch (err: any) {
      console.error("Failed to fetch staff data:", err);
      toast.error(err.message || "Failed to load staff data");
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const upsertTagRecord = async (
    row: StaffRow,
    updates: { tags?: string[]; centre_locations?: string[] }
  ) => {
    setSaving(row.userId);
    const assignedBy = user ? `${user.firstName} ${user.lastName}` : null;

    if (row.tagRecordId) {
      const { error } = await supabase
        .from("staff_centre_assignments")
        .update({
          ...updates,
          assigned_by: assignedBy,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", row.tagRecordId);

      if (error) {
        toast.error("Failed to update");
        setSaving(null);
        return;
      }
    } else {
      const newTags = updates.tags ?? row.tags;
      const newLocations = updates.centre_locations ?? row.centreLocations;

      if (newTags.length === 0 && newLocations.length === 0) {
        setSaving(null);
        return;
      }

      const { data, error } = await supabase
        .from("staff_centre_assignments")
        .insert({
          system_id: row.userId,
          user_name: `${row.firstName} ${row.lastName}`,
          user_role: row.role,
          tags: newTags,
          centre_locations: newLocations,
          assigned_by: assignedBy,
        } as any)
        .select("id")
        .single();

      if (error) {
        toast.error("Failed to save");
        setSaving(null);
        return;
      }

      setStaffRows((prev) =>
        prev.map((r) =>
          r.userId === row.userId ? { ...r, tagRecordId: (data as any).id } : r
        )
      );
    }

    setStaffRows((prev) =>
      prev.map((r) => {
        if (r.userId !== row.userId) return r;
        return {
          ...r,
          tags: updates.tags ?? r.tags,
          centreLocations: updates.centre_locations ?? r.centreLocations,
        };
      })
    );

    toast.success(`Updated ${row.firstName} ${row.lastName}`);
    setSaving(null);
  };

  const handleTagToggle = (row: StaffRow, tag: string, checked: boolean) => {
    const newTags = checked
      ? [...row.tags.filter((t) => t !== tag), tag]
      : row.tags.filter((t) => t !== tag);
    upsertTagRecord(row, { tags: newTags });
  };

  const handleLocationToggle = (row: StaffRow, location: string, checked: boolean) => {
    const newLocations = checked
      ? [...row.centreLocations.filter((l) => l !== location), location]
      : row.centreLocations.filter((l) => l !== location);
    upsertTagRecord(row, { centre_locations: newLocations });
  };

  const filtered = staffRows.filter(
    (r) =>
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      r.email.toLowerCase().includes(search.toLowerCase()) ||
      r.userId.toLowerCase().includes(search.toLowerCase()) ||
      r.centreLocations.some((l) => l.toLowerCase().includes(search.toLowerCase()))
  );

  const roleBadgeVariant = (role: string) => {
    switch (role.toLowerCase()) {
      case "centre":
      case "center":
        return "secondary" as const;
      case "management":
      case "admin":
        return "default" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold font-display text-foreground">All Staff</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            View all users and assign centre locations, requester, and approver tags
          </p>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, ID, or centre..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : staffRows.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
            No users found. Make sure the authentication system is configured correctly.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Centre Locations</TableHead>
                  <TableHead className="text-center">Requester</TableHead>
                  <TableHead className="text-center">Approver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No matching users
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">
                            {row.firstName} {row.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{row.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={roleBadgeVariant(row.role)} className="capitalize">
                            {row.role}
                          </Badge>
                          {row.companyRoles
                            .filter((cr) => cr.toLowerCase() !== row.role.toLowerCase())
                            .map((cr) => (
                              <Badge key={cr} variant={roleBadgeVariant(cr)} className="capitalize">
                                {cr}
                              </Badge>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                          {CENTRE_LOCATIONS.map((loc) => (
                            <label key={loc} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={row.centreLocations.includes(loc)}
                                onCheckedChange={(checked) => handleLocationToggle(row, loc, !!checked)}
                                disabled={saving === row.userId}
                              />
                              <span className="text-foreground">{loc}</span>
                            </label>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={row.tags.includes("requester")}
                          onCheckedChange={(checked) => handleTagToggle(row, "requester", !!checked)}
                          disabled={saving === row.userId}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={row.tags.includes("approver")}
                          onCheckedChange={(checked) => handleTagToggle(row, "approver", !!checked)}
                          disabled={saving === row.userId}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default AllStaffPage;
