import React, { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface StaffAssignment {
  id: string;
  system_id: string;
  user_name: string;
  user_role: string;
  centre_location: string;
  tags: string[];
  assigned_by: string | null;
  updated_at: string;
}

const CENTRE_LOCATIONS = [
  "KL Center",
  "PJ Center",
  "JB Center",
  "Penang Center",
  "Ipoh Center",
];

const AllStaffPage: React.FC = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newSystemId, setNewSystemId] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newRole, setNewRole] = useState("sales");
  const [newCentre, setNewCentre] = useState("");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("staff_centre_assignments")
      .select("*")
      .order("user_name", { ascending: true });

    if (error) {
      toast.error("Failed to load staff assignments");
    } else {
      setAssignments(
        ((data as any[]) || []).map((d) => ({ ...d, tags: d.tags || [] }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const handleCentreChange = async (assignment: StaffAssignment, newLocation: string) => {
    setSaving(assignment.id);
    const { error } = await supabase
      .from("staff_centre_assignments")
      .update({
        centre_location: newLocation,
        assigned_by: user ? `${user.firstName} ${user.lastName}` : null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", assignment.id);

    if (error) {
      toast.error("Failed to update centre assignment");
    } else {
      toast.success(`${assignment.user_name} assigned to ${newLocation}`);
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === assignment.id ? { ...a, centre_location: newLocation } : a
        )
      );
    }
    setSaving(null);
  };

  const handleTagToggle = async (assignment: StaffAssignment, tag: string, checked: boolean) => {
    setSaving(assignment.id);
    const newTagList = checked
      ? [...assignment.tags.filter((t) => t !== tag), tag]
      : assignment.tags.filter((t) => t !== tag);

    const { error } = await supabase
      .from("staff_centre_assignments")
      .update({
        tags: newTagList,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", assignment.id);

    if (error) {
      toast.error("Failed to update tags");
    } else {
      toast.success(`Tags updated for ${assignment.user_name}`);
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === assignment.id ? { ...a, tags: newTagList } : a
        )
      );
    }
    setSaving(null);
  };

  const handleAddStaff = async () => {
    if (!newSystemId.trim() || !newUserName.trim() || !newCentre) {
      toast.error("Please fill in all fields");
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("staff_centre_assignments").insert({
      system_id: newSystemId.trim(),
      user_name: newUserName.trim(),
      user_role: newRole,
      centre_location: newCentre,
      tags: newTags,
      assigned_by: user ? `${user.firstName} ${user.lastName}` : null,
    } as any);

    if (error) {
      if (error.message.includes("duplicate")) {
        toast.error("This system ID already exists");
      } else {
        toast.error("Failed to add staff member");
      }
    } else {
      toast.success("Staff member added");
      setNewSystemId("");
      setNewUserName("");
      setNewRole("sales");
      setNewCentre("");
      setNewTags([]);
      fetchAssignments();
    }
    setAdding(false);
  };

  const toggleNewTag = (tag: string) => {
    setNewTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const filtered = assignments.filter(
    (a) =>
      a.user_name.toLowerCase().includes(search.toLowerCase()) ||
      a.system_id.toLowerCase().includes(search.toLowerCase()) ||
      a.centre_location.toLowerCase().includes(search.toLowerCase())
  );

  const roleBadgeVariant = (role: string) => {
    switch (role.toLowerCase()) {
      case "centre":
      case "center":
        return "secondary";
      case "management":
        return "default";
      default:
        return "outline";
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
            Assign staff to centre locations and tag them as requesters or approvers
          </p>
        </div>

        {/* Add new staff */}
        <div className="bg-card border border-border rounded-xl p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold font-display text-foreground">Add Staff Member</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input
              placeholder="System ID"
              value={newSystemId}
              onChange={(e) => setNewSystemId(e.target.value)}
            />
            <Input
              placeholder="Full Name"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
            />
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="centre">Centre</SelectItem>
              </SelectContent>
            </Select>
            <Select value={newCentre} onValueChange={setNewCentre}>
              <SelectTrigger><SelectValue placeholder="Centre location" /></SelectTrigger>
              <SelectContent>
                {CENTRE_LOCATIONS.map((loc) => (
                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={newTags.includes("requester")}
                onCheckedChange={() => toggleNewTag("requester")}
              />
              Requester
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={newTags.includes("approver")}
                onCheckedChange={() => toggleNewTag("approver")}
              />
              Approver
            </label>
          </div>
          <Button onClick={handleAddStaff} disabled={adding} className="gap-2">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Add Staff
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, ID, or centre..."
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
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>System ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Centre Location</TableHead>
                  <TableHead className="text-center">Requester</TableHead>
                  <TableHead className="text-center">Approver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No staff members found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.user_name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono">{a.system_id}</TableCell>
                      <TableCell>
                        <Badge variant={roleBadgeVariant(a.user_role)} className="capitalize">
                          {a.user_role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={a.centre_location}
                          onValueChange={(v) => handleCentreChange(a, v)}
                          disabled={saving === a.id}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Assign centre" />
                          </SelectTrigger>
                          <SelectContent>
                            {CENTRE_LOCATIONS.map((loc) => (
                              <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={a.tags.includes("requester")}
                          onCheckedChange={(checked) => handleTagToggle(a, "requester", !!checked)}
                          disabled={saving === a.id}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={a.tags.includes("approver")}
                          onCheckedChange={(checked) => handleTagToggle(a, "approver", !!checked)}
                          disabled={saving === a.id}
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
