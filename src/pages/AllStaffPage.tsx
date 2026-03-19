import React, { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  centre_location: string;
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
  centreLocation: string;
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
      // Fetch users from external auth API via proxy
      const env = environment || "production";
      const { data: usersResponse, error: usersError } = await supabase.functions.invoke(
        "get-users-proxy",
        { body: null, method: "GET", headers: {} }
      );

      // Workaround: supabase.functions.invoke only supports POST by default.
      // Use fetch directly for GET requests.
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

      // Fetch existing tag records from DB
      const { data: tagRecords, error: tagError } = await supabase
        .from("staff_centre_assignments")
        .select("id, system_id, tags, centre_location");

      if (tagError) {
        toast.error("Failed to load tag records");
      }

      const tagMap = new Map<string, TagRecord>();
      ((tagRecords as any[]) || []).forEach((r) => {
        tagMap.set(r.system_id, {
          id: r.id,
          system_id: r.system_id,
          tags: r.tags || [],
          centre_location: r.centre_location || "",
        });
      });

      // Merge
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
          centreLocation: tag?.centre_location || "",
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

  /** Upsert a tag record — creates it if the user has never been tagged before */
  const upsertTagRecord = async (
    row: StaffRow,
    updates: { tags?: string[]; centre_location?: string }
  ) => {
    setSaving(row.userId);
    const assignedBy = user ? `${user.firstName} ${user.lastName}` : null;

    if (row.tagRecordId) {
      // Update existing
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
      // Insert new — only when user is being tagged
      const newTags = updates.tags ?? row.tags;
      const newCentre = updates.centre_location ?? row.centreLocation;

      // Don't insert if nothing meaningful is being set
      if (newTags.length === 0 && !newCentre) {
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
          centre_location: newCentre,
          assigned_by: assignedBy,
        } as any)
        .select("id")
        .single();

      if (error) {
        toast.error("Failed to save");
        setSaving(null);
        return;
      }

      // Update local state with the new record ID
      setStaffRows((prev) =>
        prev.map((r) =>
          r.userId === row.userId ? { ...r, tagRecordId: (data as any).id } : r
        )
      );
    }

    // Update local state
    setStaffRows((prev) =>
      prev.map((r) => {
        if (r.userId !== row.userId) return r;
        return {
          ...r,
          tags: updates.tags ?? r.tags,
          centreLocation: updates.centre_location ?? r.centreLocation,
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

  const handleCentreChange = (row: StaffRow, centre: string) => {
    upsertTagRecord(row, { centre_location: centre });
  };

  const filtered = staffRows.filter(
    (r) =>
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      r.email.toLowerCase().includes(search.toLowerCase()) ||
      r.userId.toLowerCase().includes(search.toLowerCase()) ||
      r.centreLocation.toLowerCase().includes(search.toLowerCase())
  );

  const roleBadgeVariant = (role: string) => {
    switch (role.toLowerCase()) {
      case "centre":
      case "center":
        return "secondary" as const;
      case "management":
        return "default" as const;
      case "admin":
        return "default" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold font-display text-foreground">All Staff</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            View all users and assign centre locations, requester, and approver tags
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, ID, or centre..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
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
                  <TableHead>Centre Location</TableHead>
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
                        <Select
                          value={row.centreLocation || "unassigned"}
                          onValueChange={(v) => handleCentreChange(row, v === "unassigned" ? "" : v)}
                          disabled={saving === row.userId}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Assign centre" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">
                              <span className="text-muted-foreground">Unassigned</span>
                            </SelectItem>
                            {CENTRE_LOCATIONS.map((loc) => (
                              <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
