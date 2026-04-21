export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action_type: string
          category: string
          created_at: string
          details: Json
          environment: string
          id: string
          org_id: string
          performed_by: string
          performed_by_name: string
        }
        Insert: {
          action_type: string
          category?: string
          created_at?: string
          details?: Json
          environment?: string
          id?: string
          org_id?: string
          performed_by?: string
          performed_by_name?: string
        }
        Update: {
          action_type?: string
          category?: string
          created_at?: string
          details?: Json
          environment?: string
          id?: string
          org_id?: string
          performed_by?: string
          performed_by_name?: string
        }
        Relationships: []
      }
      global_config: {
        Row: {
          id: string
          key: string
          org_id: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          org_id?: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          org_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      invoice_logs: {
        Row: {
          action_type: string
          created_at: string
          details: Json
          environment: string
          id: string
          invoice_id: string
          org_id: string
          performed_by: string
          performed_by_name: string
          source: string
        }
        Insert: {
          action_type: string
          created_at?: string
          details?: Json
          environment?: string
          id?: string
          invoice_id: string
          org_id?: string
          performed_by?: string
          performed_by_name?: string
          source?: string
        }
        Update: {
          action_type?: string
          created_at?: string
          details?: Json
          environment?: string
          id?: string
          invoice_id?: string
          org_id?: string
          performed_by?: string
          performed_by_name?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_logs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_templates: {
        Row: {
          created_at: string
          created_by: string | null
          environment: string
          fields: Json
          format_string: string
          id: string
          name: string
          org_id: string
          requires_approval: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment?: string
          fields?: Json
          format_string?: string
          id?: string
          name: string
          org_id?: string
          requires_approval?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: string
          fields?: Json
          format_string?: string
          id?: string
          name?: string
          org_id?: string
          requires_approval?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amendment_data: Json | null
          amendment_note: string | null
          amendment_requested_at: string | null
          amendment_requested_by: string | null
          amendment_requested_by_name: string | null
          amendment_status: string | null
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          callback_url: string | null
          contact_id: string | null
          contact_name: string
          created_at: string
          environment: string
          id: string
          invoice_date: string
          invoice_number: string | null
          invoice_pdf_url: string | null
          line_items: Json
          org_id: string
          receipt_pdf_url: string | null
          reference: string | null
          requires_approval: boolean
          status: string
          submitted_by_email: string | null
          submitted_by_name: string
          submitted_by_system_id: string
          template_id: string | null
          total: number
        }
        Insert: {
          amendment_data?: Json | null
          amendment_note?: string | null
          amendment_requested_at?: string | null
          amendment_requested_by?: string | null
          amendment_requested_by_name?: string | null
          amendment_status?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          callback_url?: string | null
          contact_id?: string | null
          contact_name: string
          created_at?: string
          environment?: string
          id?: string
          invoice_date: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          line_items?: Json
          org_id?: string
          receipt_pdf_url?: string | null
          reference?: string | null
          requires_approval?: boolean
          status?: string
          submitted_by_email?: string | null
          submitted_by_name?: string
          submitted_by_system_id: string
          template_id?: string | null
          total?: number
        }
        Update: {
          amendment_data?: Json | null
          amendment_note?: string | null
          amendment_requested_at?: string | null
          amendment_requested_by?: string | null
          amendment_requested_by_name?: string | null
          amendment_status?: string | null
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          callback_url?: string | null
          contact_id?: string | null
          contact_name?: string
          created_at?: string
          environment?: string
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          line_items?: Json
          org_id?: string
          receipt_pdf_url?: string | null
          reference?: string | null
          requires_approval?: boolean
          status?: string
          submitted_by_email?: string | null
          submitted_by_name?: string
          submitted_by_system_id?: string
          template_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_centre_assignments: {
        Row: {
          assigned_by: string | null
          centre_locations: string[]
          created_at: string
          environment: string
          id: string
          org_id: string
          system_id: string
          tags: string[]
          updated_at: string
          user_name: string
          user_role: string
        }
        Insert: {
          assigned_by?: string | null
          centre_locations?: string[]
          created_at?: string
          environment?: string
          id?: string
          org_id?: string
          system_id: string
          tags?: string[]
          updated_at?: string
          user_name?: string
          user_role?: string
        }
        Update: {
          assigned_by?: string | null
          centre_locations?: string[]
          created_at?: string
          environment?: string
          id?: string
          org_id?: string
          system_id?: string
          tags?: string[]
          updated_at?: string
          user_name?: string
          user_role?: string
        }
        Relationships: []
      }
      user_approval_flags: {
        Row: {
          created_at: string
          environment: string
          flagged_by: string | null
          id: string
          org_id: string
          requires_approval: boolean
          system_id: string
          updated_at: string
          user_name: string
        }
        Insert: {
          created_at?: string
          environment?: string
          flagged_by?: string | null
          id?: string
          org_id?: string
          requires_approval?: boolean
          system_id: string
          updated_at?: string
          user_name?: string
        }
        Update: {
          created_at?: string
          environment?: string
          flagged_by?: string | null
          id?: string
          org_id?: string
          requires_approval?: boolean
          system_id?: string
          updated_at?: string
          user_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
