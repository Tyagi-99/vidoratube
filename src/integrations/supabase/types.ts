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
    PostgrestVersion: "14.5"
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
      asset_provenance: {
        Row: {
          asset_url: string | null
          cost_credits: number | null
          created_at: string
          id: string
          kind: string | null
          license: string | null
          license_url: string | null
          model: string | null
          project_id: string | null
          prompt: string | null
          provider: string | null
          scene_id: string | null
          seed: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          asset_url?: string | null
          cost_credits?: number | null
          created_at?: string
          id?: string
          kind?: string | null
          license?: string | null
          license_url?: string | null
          model?: string | null
          project_id?: string | null
          prompt?: string | null
          provider?: string | null
          scene_id?: string | null
          seed?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          asset_url?: string | null
          cost_credits?: number | null
          created_at?: string
          id?: string
          kind?: string | null
          license?: string | null
          license_url?: string | null
          model?: string | null
          project_id?: string | null
          prompt?: string | null
          provider?: string | null
          scene_id?: string | null
          seed?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          payload: Json | null
          provider: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          payload?: Json | null
          provider?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          payload?: Json | null
          provider?: string | null
        }
        Relationships: []
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
      channel_stats: {
        Row: {
          created_at: string
          id: string
          metrics: Json | null
          snapshot_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metrics?: Json | null
          snapshot_date?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metrics?: Json | null
          snapshot_date?: string | null
          user_id?: string
        }
        Relationships: []
      }
      characters: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string | null
          reference_image_url: string | null
          style: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          reference_image_url?: string | null
          style?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          reference_image_url?: string | null
          style?: string | null
          user_id?: string
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
      content_assets: {
        Row: {
          bytes: number | null
          checksum_sha256: string | null
          content_item_id: string
          created_at: string
          duration_seconds: number | null
          height: number | null
          id: string
          kind: string
          mime_type: string | null
          origin: string
          perceptual_hash: string | null
          rights_basis: string
          source_url: string | null
          storage_path: string | null
          technical_metadata: Json
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          bytes?: number | null
          checksum_sha256?: string | null
          content_item_id: string
          created_at?: string
          duration_seconds?: number | null
          height?: number | null
          id?: string
          kind: string
          mime_type?: string | null
          origin: string
          perceptual_hash?: string | null
          rights_basis?: string
          source_url?: string | null
          storage_path?: string | null
          technical_metadata?: Json
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          bytes?: number | null
          checksum_sha256?: string | null
          content_item_id?: string
          created_at?: string
          duration_seconds?: number | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          origin?: string
          perceptual_hash?: string | null
          rights_basis?: string
          source_url?: string | null
          storage_path?: string | null
          technical_metadata?: Json
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_assets_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_duplicate_flags: {
        Row: {
          confidence: number
          content_item_id: string
          created_at: string
          details: Json
          duplicate_of_id: string | null
          id: string
          match_type: string
          status: string
          user_id: string
        }
        Insert: {
          confidence?: number
          content_item_id: string
          created_at?: string
          details?: Json
          duplicate_of_id?: string | null
          id?: string
          match_type: string
          status?: string
          user_id: string
        }
        Update: {
          confidence?: number
          content_item_id?: string
          created_at?: string
          details?: Json
          duplicate_of_id?: string | null
          id?: string
          match_type?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_duplicate_flags_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_duplicate_flags_duplicate_of_id_fkey"
            columns: ["duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          canonical_url: string
          caption: string | null
          category: string | null
          comments: number | null
          created_at: string
          creator_account_id: string | null
          creator_id: string | null
          description: string | null
          discovery_date: string
          duration_seconds: number | null
          engagement_score: number | null
          followers: number | null
          freshness_score: number | null
          hashtags: string[]
          id: string
          language: string | null
          likes: number | null
          metadata_incomplete: boolean
          niche_id: string | null
          niche_relevance_score: number | null
          pipeline_stage: string
          platform: string
          platform_id: string | null
          project_id: string | null
          raw_metadata: Json
          rights_status: string
          shares: number | null
          source_kind: string
          tags: string[]
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          uploaded_at: string | null
          user_id: string
          view_velocity: number | null
          views: number | null
          viral_potential_score: number | null
        }
        Insert: {
          canonical_url: string
          caption?: string | null
          category?: string | null
          comments?: number | null
          created_at?: string
          creator_account_id?: string | null
          creator_id?: string | null
          description?: string | null
          discovery_date?: string
          duration_seconds?: number | null
          engagement_score?: number | null
          followers?: number | null
          freshness_score?: number | null
          hashtags?: string[]
          id?: string
          language?: string | null
          likes?: number | null
          metadata_incomplete?: boolean
          niche_id?: string | null
          niche_relevance_score?: number | null
          pipeline_stage?: string
          platform?: string
          platform_id?: string | null
          project_id?: string | null
          raw_metadata?: Json
          rights_status?: string
          shares?: number | null
          source_kind?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          uploaded_at?: string | null
          user_id: string
          view_velocity?: number | null
          views?: number | null
          viral_potential_score?: number | null
        }
        Update: {
          canonical_url?: string
          caption?: string | null
          category?: string | null
          comments?: number | null
          created_at?: string
          creator_account_id?: string | null
          creator_id?: string | null
          description?: string | null
          discovery_date?: string
          duration_seconds?: number | null
          engagement_score?: number | null
          followers?: number | null
          freshness_score?: number | null
          hashtags?: string[]
          id?: string
          language?: string | null
          likes?: number | null
          metadata_incomplete?: boolean
          niche_id?: string | null
          niche_relevance_score?: number | null
          pipeline_stage?: string
          platform?: string
          platform_id?: string | null
          project_id?: string | null
          raw_metadata?: Json
          rights_status?: string
          shares?: number | null
          source_kind?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          uploaded_at?: string | null
          user_id?: string
          view_velocity?: number | null
          views?: number | null
          viral_potential_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_creator_account_id_fkey"
            columns: ["creator_account_id"]
            isOneToOne: false
            referencedRelation: "creator_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_niche_id_fkey"
            columns: ["niche_id"]
            isOneToOne: false
            referencedRelation: "niches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_accounts: {
        Row: {
          created_at: string
          creator_id: string
          engagement_rate: number | null
          followers: number | null
          id: string
          permission_status: string
          platform: string
          platform_user_id: string | null
          profile_url: string | null
          public_contact: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          creator_id: string
          engagement_rate?: number | null
          followers?: number | null
          id?: string
          permission_status?: string
          platform: string
          platform_user_id?: string | null
          profile_url?: string | null
          public_contact?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          creator_id?: string
          engagement_rate?: number | null
          followers?: number | null
          id?: string
          permission_status?: string
          platform?: string
          platform_user_id?: string | null
          profile_url?: string | null
          public_contact?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_accounts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          created_at: string
          display_name: string
          id: string
          niche_tags: string[]
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id?: string
          niche_tags?: string[]
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          niche_tags?: string[]
          notes?: string | null
          updated_at?: string
          user_id?: string
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
      learning_insights: {
        Row: {
          created_at: string
          id: string
          kind: string | null
          monetization_status: string | null
          note: string | null
          payload: Json | null
          safety_score: number | null
          title: string | null
          user_id: string
          youtube_video_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string | null
          monetization_status?: string | null
          note?: string | null
          payload?: Json | null
          safety_score?: number | null
          title?: string | null
          user_id: string
          youtube_video_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string | null
          monetization_status?: string | null
          note?: string | null
          payload?: Json | null
          safety_score?: number | null
          title?: string | null
          user_id?: string
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      music_tracks: {
        Row: {
          artist: string | null
          created_at: string
          download_url: string | null
          duration_secs: number | null
          id: string
          license: string | null
          license_url: string | null
          mood: string | null
          preview_url: string | null
          provider: string | null
          provider_track_id: string | null
          title: string | null
        }
        Insert: {
          artist?: string | null
          created_at?: string
          download_url?: string | null
          duration_secs?: number | null
          id?: string
          license?: string | null
          license_url?: string | null
          mood?: string | null
          preview_url?: string | null
          provider?: string | null
          provider_track_id?: string | null
          title?: string | null
        }
        Update: {
          artist?: string | null
          created_at?: string
          download_url?: string | null
          duration_secs?: number | null
          id?: string
          license?: string | null
          license_url?: string | null
          mood?: string | null
          preview_url?: string | null
          provider?: string | null
          provider_track_id?: string | null
          title?: string | null
        }
        Relationships: []
      }
      niches: {
        Row: {
          content_style: string
          created_at: string
          enabled: boolean
          hashtags: string[]
          id: string
          keywords: string[]
          min_engagement_rate: number
          min_views: number
          name: string
          preferred_duration_seconds_max: number | null
          preferred_duration_seconds_min: number | null
          preferred_format: string
          preferred_language: string
          scoring_weights: Json
          search_queries: string[]
          slug: string
          target_platforms: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          content_style?: string
          created_at?: string
          enabled?: boolean
          hashtags?: string[]
          id?: string
          keywords?: string[]
          min_engagement_rate?: number
          min_views?: number
          name: string
          preferred_duration_seconds_max?: number | null
          preferred_duration_seconds_min?: number | null
          preferred_format?: string
          preferred_language?: string
          scoring_weights?: Json
          search_queries?: string[]
          slug: string
          target_platforms?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          content_style?: string
          created_at?: string
          enabled?: boolean
          hashtags?: string[]
          id?: string
          keywords?: string[]
          min_engagement_rate?: number
          min_views?: number
          name?: string
          preferred_duration_seconds_max?: number | null
          preferred_duration_seconds_min?: number | null
          preferred_format?: string
          preferred_language?: string
          scoring_weights?: Json
          search_queries?: string[]
          slug?: string
          target_platforms?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      outlier_videos: {
        Row: {
          channel_title: string | null
          created_at: string
          ctr: number | null
          id: string
          outlier_score: number | null
          patterns: Json | null
          project_id: string | null
          published_at: string | null
          retention: number | null
          source: string | null
          title: string | null
          user_id: string
          view_count: number | null
          youtube_id: string | null
        }
        Insert: {
          channel_title?: string | null
          created_at?: string
          ctr?: number | null
          id?: string
          outlier_score?: number | null
          patterns?: Json | null
          project_id?: string | null
          published_at?: string | null
          retention?: number | null
          source?: string | null
          title?: string | null
          user_id: string
          view_count?: number | null
          youtube_id?: string | null
        }
        Update: {
          channel_title?: string | null
          created_at?: string
          ctr?: number | null
          id?: string
          outlier_score?: number | null
          patterns?: Json | null
          project_id?: string | null
          published_at?: string | null
          retention?: number | null
          source?: string | null
          title?: string | null
          user_id?: string
          view_count?: number | null
          youtube_id?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          created_at: string
          credits: number | null
          features: Json | null
          id: string
          name: string | null
          price_cents: number | null
          slug: string | null
        }
        Insert: {
          created_at?: string
          credits?: number | null
          features?: Json | null
          id?: string
          name?: string | null
          price_cents?: number | null
          slug?: string | null
        }
        Update: {
          created_at?: string
          credits?: number | null
          features?: Json | null
          id?: string
          name?: string | null
          price_cents?: number | null
          slug?: string | null
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
          creation_mode: string
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
          creation_mode?: string
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
          creation_mode?: string
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
      publish_jobs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          description: string | null
          error: string | null
          id: string
          made_for_kids: boolean | null
          privacy: string | null
          project_id: string | null
          published_at: string | null
          safety_override: boolean | null
          safety_score: number | null
          scheduled_for: string | null
          status: string
          tags: string[] | null
          thumbnail_id: string | null
          title: string | null
          updated_at: string
          user_id: string
          video_job_id: string | null
          youtube_url: string | null
          youtube_video_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          made_for_kids?: boolean | null
          privacy?: string | null
          project_id?: string | null
          published_at?: string | null
          safety_override?: boolean | null
          safety_score?: number | null
          scheduled_for?: string | null
          status?: string
          tags?: string[] | null
          thumbnail_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          video_job_id?: string | null
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          made_for_kids?: boolean | null
          privacy?: string | null
          project_id?: string | null
          published_at?: string | null
          safety_override?: boolean | null
          safety_score?: number | null
          scheduled_for?: string | null
          status?: string
          tags?: string[] | null
          thumbnail_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          video_job_id?: string | null
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string | null
          created_at: string
          id: string
          referee_id: string | null
          referrer_id: string
          status: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          referee_id?: string | null
          referrer_id: string
          status?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          referee_id?: string | null
          referrer_id?: string
          status?: string | null
        }
        Relationships: []
      }
      renders: {
        Row: {
          aspect_ratio: string | null
          created_at: string
          duration: number | null
          engine: string
          error: string | null
          file_size: number | null
          file_url: string | null
          format: string
          id: string
          job_id: string | null
          meta: Json
          progress: number
          project_id: string | null
          render_completed_at: string | null
          render_started_at: string | null
          resolution: string | null
          stage: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          created_at?: string
          duration?: number | null
          engine?: string
          error?: string | null
          file_size?: number | null
          file_url?: string | null
          format?: string
          id?: string
          job_id?: string | null
          meta?: Json
          progress?: number
          project_id?: string | null
          render_completed_at?: string | null
          render_started_at?: string | null
          resolution?: string | null
          stage?: string
          status?: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string | null
          created_at?: string
          duration?: number | null
          engine?: string
          error?: string | null
          file_size?: number | null
          file_url?: string | null
          format?: string
          id?: string
          job_id?: string | null
          meta?: Json
          progress?: number
          project_id?: string | null
          render_completed_at?: string | null
          render_started_at?: string | null
          resolution?: string | null
          stage?: string
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_projects: {
        Row: {
          created_at: string
          id: string
          language: string | null
          niches: string[] | null
          topic: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string | null
          niches?: string[] | null
          topic?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string | null
          niches?: string[] | null
          topic?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rights_decisions: {
        Row: {
          content_item_id: string
          created_at: string
          creator_account_id: string | null
          decided_at: string
          decided_by: string | null
          evidence_notes: string
          evidence_url: string | null
          id: string
          status: string
          user_id: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          creator_account_id?: string | null
          decided_at?: string
          decided_by?: string | null
          evidence_notes?: string
          evidence_url?: string | null
          id?: string
          status: string
          user_id: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          creator_account_id?: string | null
          decided_at?: string
          decided_by?: string | null
          evidence_notes?: string
          evidence_url?: string | null
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_decisions_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rights_decisions_creator_account_id_fkey"
            columns: ["creator_account_id"]
            isOneToOne: false
            referencedRelation: "creator_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_scores: {
        Row: {
          band: string | null
          created_at: string
          dimensions: Json | null
          id: string
          issues: Json | null
          model: string | null
          project_id: string | null
          score: number | null
          suggestions: Json | null
          user_id: string
          version: string | null
        }
        Insert: {
          band?: string | null
          created_at?: string
          dimensions?: Json | null
          id?: string
          issues?: Json | null
          model?: string | null
          project_id?: string | null
          score?: number | null
          suggestions?: Json | null
          user_id: string
          version?: string | null
        }
        Update: {
          band?: string | null
          created_at?: string
          dimensions?: Json | null
          id?: string
          issues?: Json | null
          model?: string | null
          project_id?: string | null
          score?: number | null
          suggestions?: Json | null
          user_id?: string
          version?: string | null
        }
        Relationships: []
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
      seo_metadata: {
        Row: {
          chapters: Json | null
          created_at: string
          description: string | null
          hashtags: string[] | null
          id: string
          project_id: string | null
          selected_title: string | null
          status: string | null
          tags: string[] | null
          thumbnail_id: string | null
          titles: Json | null
          updated_at: string
          user_id: string
          video_job_id: string | null
        }
        Insert: {
          chapters?: Json | null
          created_at?: string
          description?: string | null
          hashtags?: string[] | null
          id?: string
          project_id?: string | null
          selected_title?: string | null
          status?: string | null
          tags?: string[] | null
          thumbnail_id?: string | null
          titles?: Json | null
          updated_at?: string
          user_id: string
          video_job_id?: string | null
        }
        Update: {
          chapters?: Json | null
          created_at?: string
          description?: string | null
          hashtags?: string[] | null
          id?: string
          project_id?: string | null
          selected_title?: string | null
          status?: string | null
          tags?: string[] | null
          thumbnail_id?: string | null
          titles?: Json | null
          updated_at?: string
          user_id?: string
          video_job_id?: string | null
        }
        Relationships: []
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
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          external_id: string | null
          id: string
          plan_slug: string | null
          provider: string | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_id?: string | null
          id?: string
          plan_slug?: string | null
          provider?: string | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_id?: string | null
          id?: string
          plan_slug?: string | null
          provider?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      thumbnails: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          model: string | null
          project_id: string | null
          provider: string | null
          selected: boolean | null
          text_overlay: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          model?: string | null
          project_id?: string | null
          provider?: string | null
          selected?: boolean | null
          text_overlay?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          model?: string | null
          project_id?: string | null
          provider?: string | null
          selected?: boolean | null
          text_overlay?: Json | null
          user_id?: string
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
      video_analytics: {
        Row: {
          age_days: number | null
          created_at: string
          id: string
          metrics: Json | null
          publish_job_id: string | null
          snapshot_date: string | null
          user_id: string
          youtube_video_id: string | null
        }
        Insert: {
          age_days?: number | null
          created_at?: string
          id?: string
          metrics?: Json | null
          publish_job_id?: string | null
          snapshot_date?: string | null
          user_id: string
          youtube_video_id?: string | null
        }
        Update: {
          age_days?: number | null
          created_at?: string
          id?: string
          metrics?: Json | null
          publish_job_id?: string | null
          snapshot_date?: string | null
          user_id?: string
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      video_ideas: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          status?: string | null
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
      workflow_job_events: {
        Row: {
          created_at: string
          data: Json
          id: string
          level: string
          message: string
          user_id: string
          workflow_job_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          level?: string
          message: string
          user_id: string
          workflow_job_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          level?: string
          message?: string
          user_id?: string
          workflow_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_job_events_workflow_job_id_fkey"
            columns: ["workflow_job_id"]
            isOneToOne: false
            referencedRelation: "workflow_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_jobs: {
        Row: {
          attempt: number
          content_item_id: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_type: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          progress: number
          project_id: string | null
          result: Json
          run_after: string
          stage: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt?: number
          content_item_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          progress?: number
          project_id?: string | null
          result?: Json
          run_after?: string
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt?: number
          content_item_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_type?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          progress?: number
          project_id?: string | null
          result?: Json
          run_after?: string
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_jobs_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_api_cache: {
        Row: {
          cache_key: string | null
          created_at: string
          expires_at: string | null
          id: string
          payload: Json | null
          user_id: string | null
        }
        Insert: {
          cache_key?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Update: {
          cache_key?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Relationships: []
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
      content_rights_approved: {
        Args: { _content_id: string }
        Returns: boolean
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
