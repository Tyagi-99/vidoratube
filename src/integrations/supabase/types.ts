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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      api_usage: {
        Row: {
          created_at: string
          estimated_cost: number
          id: string
          meta: Json
          operation: string
          project_id: string | null
          provider: string
          units: number
          user_id: string
        }
        Insert: {
          created_at?: string
          estimated_cost?: number
          id?: string
          meta?: Json
          operation: string
          project_id?: string | null
          provider: string
          units?: number
          user_id: string
        }
        Update: {
          created_at?: string
          estimated_cost?: number
          id?: string
          meta?: Json
          operation?: string
          project_id?: string | null
          provider?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      captions: {
        Row: {
          created_at: string
          cues: Json
          id: string
          project_id: string
          scene_id: string | null
          style: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cues?: Json
          id?: string
          project_id: string
          scene_id?: string | null
          style?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cues?: Json
          id?: string
          project_id?: string
          scene_id?: string | null
          style?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "captions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captions_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          group_name: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_name: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          group_name?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          handled: boolean
          id: string
          message: string
          name: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          email: string
          handled?: boolean
          id?: string
          message: string
          name: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          handled?: boolean
          id?: string
          message?: string
          name?: string
          subject?: string | null
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          admin_id: string | null
          created_at: string
          delta: number
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          admin_id?: string | null
          created_at?: string
          delta: number
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          admin_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          category: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          label: string
          last_checked_at: string | null
          provider: string
          secret_name: string | null
          settings: Json
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          label: string
          last_checked_at?: string | null
          provider: string
          secret_name?: string | null
          settings?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          label?: string
          last_checked_at?: string | null
          provider?: string
          secret_name?: string | null
          settings?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pricing_plans: {
        Row: {
          active: boolean
          blurb: string | null
          created_at: string
          credits: number
          features: Json
          highlighted: boolean
          id: string
          name: string
          price_monthly: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          blurb?: string | null
          created_at?: string
          credits?: number
          features?: Json
          highlighted?: boolean
          id?: string
          name: string
          price_monthly?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          blurb?: string | null
          created_at?: string
          credits?: number
          features?: Json
          highlighted?: boolean
          id?: string
          name?: string
          price_monthly?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          credits: number
          display_name: string | null
          email: string | null
          id: string
          plan: string
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          email?: string | null
          id: string
          plan?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          email?: string | null
          id?: string
          plan?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          aspect_ratio: string
          audio_url: string | null
          category: string | null
          created_at: string
          duration_minutes: number
          error: string | null
          id: string
          job_id: string | null
          language: string
          mode: string
          narration: string | null
          preset: string
          result_url: string | null
          script: string | null
          settings: Json
          stage: string
          status: string
          step: string
          thumbnail_url: string | null
          title: string
          topic: string
          updated_at: string
          user_id: string
          visual_bible: Json
          visual_style: string
        }
        Insert: {
          aspect_ratio?: string
          audio_url?: string | null
          category?: string | null
          created_at?: string
          duration_minutes?: number
          error?: string | null
          id?: string
          job_id?: string | null
          language?: string
          mode?: string
          narration?: string | null
          preset?: string
          result_url?: string | null
          script?: string | null
          settings?: Json
          stage?: string
          status?: string
          step?: string
          thumbnail_url?: string | null
          title?: string
          topic?: string
          updated_at?: string
          user_id: string
          visual_bible?: Json
          visual_style?: string
        }
        Update: {
          aspect_ratio?: string
          audio_url?: string | null
          category?: string | null
          created_at?: string
          duration_minutes?: number
          error?: string | null
          id?: string
          job_id?: string | null
          language?: string
          mode?: string
          narration?: string | null
          preset?: string
          result_url?: string | null
          script?: string | null
          settings?: Json
          stage?: string
          status?: string
          step?: string
          thumbnail_url?: string | null
          title?: string
          topic?: string
          updated_at?: string
          user_id?: string
          visual_bible?: Json
          visual_style?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "video_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          asset_source: Json
          asset_thumb_url: string | null
          asset_url: string | null
          created_at: string
          duration: number
          error: string | null
          id: string
          motion_type: string
          narration: string
          negative_prompt: string | null
          project_id: string
          scene_number: number
          search_query: string | null
          status: string
          style_override: string | null
          transition: string
          updated_at: string
          user_id: string
          visual_prompt: string | null
          visual_type: string
        }
        Insert: {
          asset_source?: Json
          asset_thumb_url?: string | null
          asset_url?: string | null
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          motion_type?: string
          narration?: string
          negative_prompt?: string | null
          project_id: string
          scene_number: number
          search_query?: string | null
          status?: string
          style_override?: string | null
          transition?: string
          updated_at?: string
          user_id: string
          visual_prompt?: string | null
          visual_type?: string
        }
        Update: {
          asset_source?: Json
          asset_thumb_url?: string | null
          asset_url?: string | null
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          motion_type?: string
          narration?: string
          negative_prompt?: string | null
          project_id?: string
          scene_number?: number
          search_query?: string | null
          status?: string
          style_override?: string | null
          transition?: string
          updated_at?: string
          user_id?: string
          visual_prompt?: string | null
          visual_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_content: {
        Row: {
          key: string
          label: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          label: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          label?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_jobs: {
        Row: {
          assets: Json
          audio_url: string | null
          created_at: string
          credits_used: number
          duration_seconds: number | null
          error: string | null
          format: string
          id: string
          narration: string | null
          progress: number
          render_id: string | null
          result_url: string | null
          scenes: Json
          script: string
          stage: string
          status: Database["public"]["Enums"]["job_status"]
          step: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
          voice: string
          youtube_status: string | null
          youtube_video_id: string | null
        }
        Insert: {
          assets?: Json
          audio_url?: string | null
          created_at?: string
          credits_used?: number
          duration_seconds?: number | null
          error?: string | null
          format?: string
          id?: string
          narration?: string | null
          progress?: number
          render_id?: string | null
          result_url?: string | null
          scenes?: Json
          script: string
          stage?: string
          status?: Database["public"]["Enums"]["job_status"]
          step?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id: string
          voice?: string
          youtube_status?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          assets?: Json
          audio_url?: string | null
          created_at?: string
          credits_used?: number
          duration_seconds?: number | null
          error?: string | null
          format?: string
          id?: string
          narration?: string | null
          progress?: number
          render_id?: string | null
          result_url?: string | null
          scenes?: Json
          script?: string
          stage?: string
          status?: Database["public"]["Enums"]["job_status"]
          step?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          voice?: string
          youtube_status?: string | null
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      voiceovers: {
        Row: {
          audio_url: string | null
          cache_key: string | null
          characters: number
          created_at: string
          duration: number | null
          id: string
          model: string | null
          project_id: string
          scene_id: string | null
          user_id: string
          voice_id: string | null
        }
        Insert: {
          audio_url?: string | null
          cache_key?: string | null
          characters?: number
          created_at?: string
          duration?: number | null
          id?: string
          model?: string | null
          project_id: string
          scene_id?: string | null
          user_id: string
          voice_id?: string | null
        }
        Update: {
          audio_url?: string | null
          cache_key?: string | null
          characters?: number
          created_at?: string
          duration?: number | null
          id?: string
          model?: string | null
          project_id?: string
          scene_id?: string | null
          user_id?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voiceovers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voiceovers_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_connections: {
        Row: {
          access_token: string | null
          channel_id: string | null
          channel_title: string | null
          created_at: string
          expires_at: string | null
          id: string
          refresh_token: string
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          channel_id?: string | null
          channel_title?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          refresh_token: string
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          channel_id?: string | null
          channel_title?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          refresh_token?: string
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      account_status: "active" | "suspended"
      app_role: "admin" | "user" | "owner"
      job_status: "queued" | "running" | "completed" | "failed"
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
    Enums: {
      account_status: ["active", "suspended"],
      app_role: ["admin", "user", "owner"],
      job_status: ["queued", "running", "completed", "failed"],
    },
  },
} as const
