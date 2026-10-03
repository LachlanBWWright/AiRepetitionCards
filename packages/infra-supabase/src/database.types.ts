export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_observations: {
        Row: {
          confidence: number;
          created_at: string;
          evidence_summary: string;
          id: string;
          misconception: string | null;
          objective_id: string | null;
          payload: NonNullable<Json>;
          result: string;
          session_id: string;
          suggested_action: string;
          user_id: string;
        };
        Insert: {
          confidence: number;
          created_at?: string;
          evidence_summary: string;
          id: string;
          misconception?: string | null;
          objective_id?: string | null;
          payload: NonNullable<Json>;
          result: string;
          session_id: string;
          suggested_action: string;
          user_id: string;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          evidence_summary?: string;
          id?: string;
          misconception?: string | null;
          objective_id?: string | null;
          payload?: NonNullable<Json>;
          result?: string;
          session_id?: string;
          suggested_action?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_observations_user_id_session_id_fkey";
            columns: ["user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "tutor_sessions";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      card_objectives: {
        Row: {
          card_id: string;
          knowledge_area_id: string;
          objective_id: string;
        };
        Insert: {
          card_id: string;
          knowledge_area_id: string;
          objective_id: string;
        };
        Update: {
          card_id?: string;
          knowledge_area_id?: string;
          objective_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "card_objectives_knowledge_area_id_card_id_fkey";
            columns: ["knowledge_area_id", "card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["knowledge_area_id", "id"];
          },
          {
            foreignKeyName: "card_objectives_knowledge_area_id_objective_id_fkey";
            columns: ["knowledge_area_id", "objective_id"];
            isOneToOne: false;
            referencedRelation: "learning_objectives";
            referencedColumns: ["knowledge_area_id", "id"];
          },
        ];
      };
      card_revisions: {
        Row: {
          base_revision_id: string | null;
          card_id: string;
          content: NonNullable<Json>;
          created_at: string;
          created_by: string;
          creator_type: string;
          id: string;
          provenance: string;
          revision: number;
        };
        Insert: {
          base_revision_id?: string | null;
          card_id: string;
          content: NonNullable<Json>;
          created_at?: string;
          created_by: string;
          creator_type: string;
          id: string;
          provenance: string;
          revision: number;
        };
        Update: {
          base_revision_id?: string | null;
          card_id?: string;
          content?: NonNullable<Json>;
          created_at?: string;
          created_by?: string;
          creator_type?: string;
          id?: string;
          provenance?: string;
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "card_revisions_card_id_base_revision_id_fkey";
            columns: ["card_id", "base_revision_id"];
            isOneToOne: false;
            referencedRelation: "card_revisions";
            referencedColumns: ["card_id", "id"];
          },
          {
            foreignKeyName: "card_revisions_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      cards: {
        Row: {
          created_at: string;
          current_revision: number;
          deleted_at: string | null;
          id: string;
          knowledge_area_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_revision?: number;
          deleted_at?: string | null;
          id: string;
          knowledge_area_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_revision?: number;
          deleted_at?: string | null;
          id?: string;
          knowledge_area_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cards_current_revision_fk";
            columns: ["id", "current_revision"];
            isOneToOne: false;
            referencedRelation: "card_revisions";
            referencedColumns: ["card_id", "revision"];
          },
          {
            foreignKeyName: "cards_knowledge_area_id_fkey";
            columns: ["knowledge_area_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_areas";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_card_proposals: {
        Row: {
          approved_card_id: string | null;
          approved_revision_id: string | null;
          content: NonNullable<Json>;
          created_at: string;
          id: string;
          observation_id: string;
          resolved_at: string | null;
          session_id: string;
          state: string;
          user_id: string;
        };
        Insert: {
          approved_card_id?: string | null;
          approved_revision_id?: string | null;
          content: NonNullable<Json>;
          created_at?: string;
          id: string;
          observation_id: string;
          resolved_at?: string | null;
          session_id: string;
          state?: string;
          user_id: string;
        };
        Update: {
          approved_card_id?: string | null;
          approved_revision_id?: string | null;
          content?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          observation_id?: string;
          resolved_at?: string | null;
          session_id?: string;
          state?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_card_proposals_approved_revision_id_fkey";
            columns: ["approved_revision_id"];
            isOneToOne: false;
            referencedRelation: "card_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_card_proposals_observation_id_fkey";
            columns: ["observation_id"];
            isOneToOne: false;
            referencedRelation: "ai_observations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_card_proposals_user_id_observation_id_fkey";
            columns: ["user_id", "observation_id"];
            isOneToOne: false;
            referencedRelation: "ai_observations";
            referencedColumns: ["user_id", "id"];
          },
          {
            foreignKeyName: "generated_card_proposals_user_id_session_id_fkey";
            columns: ["user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "tutor_sessions";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      knowledge_area_versions: {
        Row: {
          content: NonNullable<Json>;
          content_hash: string;
          created_at: string;
          created_by: string;
          id: string;
          knowledge_area_id: string;
          parent_version_id: string | null;
          published_at: string | null;
          version: number;
        };
        Insert: {
          content: NonNullable<Json>;
          content_hash: string;
          created_at?: string;
          created_by: string;
          id: string;
          knowledge_area_id: string;
          parent_version_id?: string | null;
          published_at?: string | null;
          version: number;
        };
        Update: {
          content?: NonNullable<Json>;
          content_hash?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          knowledge_area_id?: string;
          parent_version_id?: string | null;
          published_at?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_area_versions_knowledge_area_id_fkey";
            columns: ["knowledge_area_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_area_versions_knowledge_area_id_parent_version_i_fkey";
            columns: ["knowledge_area_id", "parent_version_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_area_versions";
            referencedColumns: ["knowledge_area_id", "id"];
          },
        ];
      };
      knowledge_areas: {
        Row: {
          color: string;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          language: string;
          owner_id: string;
          revision: number;
          tags: string[];
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          color: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          id: string;
          language?: string;
          owner_id: string;
          revision?: number;
          tags?: string[];
          title: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          language?: string;
          owner_id?: string;
          revision?: number;
          tags?: string[];
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      learning_objectives: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          knowledge_area_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id: string;
          knowledge_area_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          knowledge_area_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_objectives_knowledge_area_id_fkey";
            columns: ["knowledge_area_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_areas";
            referencedColumns: ["id"];
          },
        ];
      };
      objective_prerequisites: {
        Row: {
          knowledge_area_id: string;
          objective_id: string;
          prerequisite_id: string;
        };
        Insert: {
          knowledge_area_id: string;
          objective_id: string;
          prerequisite_id: string;
        };
        Update: {
          knowledge_area_id?: string;
          objective_id?: string;
          prerequisite_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "objective_prerequisites_knowledge_area_id_objective_id_fkey";
            columns: ["knowledge_area_id", "objective_id"];
            isOneToOne: false;
            referencedRelation: "learning_objectives";
            referencedColumns: ["knowledge_area_id", "id"];
          },
          {
            foreignKeyName: "objective_prerequisites_knowledge_area_id_prerequisite_id_fkey";
            columns: ["knowledge_area_id", "prerequisite_id"];
            isOneToOne: false;
            referencedRelation: "learning_objectives";
            referencedColumns: ["knowledge_area_id", "id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          handle: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          handle?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          handle?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      published_knowledge_area_versions: {
        Row: {
          attribution: string | null;
          content: NonNullable<Json>;
          content_hash: string;
          created_at: string;
          created_by: string | null;
          forked_from_version_id: string | null;
          id: string;
          license: string | null;
          owner_id: string | null;
          share_token_hash: string | null;
          source_area_id: string | null;
          version: number;
          visibility: string;
        };
        Insert: {
          attribution?: string | null;
          content: NonNullable<Json>;
          content_hash: string;
          created_at?: string;
          created_by?: string | null;
          forked_from_version_id?: string | null;
          id: string;
          license?: string | null;
          owner_id?: string | null;
          share_token_hash?: string | null;
          source_area_id?: string | null;
          version: number;
          visibility: string;
        };
        Update: {
          attribution?: string | null;
          content?: NonNullable<Json>;
          content_hash?: string;
          created_at?: string;
          created_by?: string | null;
          forked_from_version_id?: string | null;
          id?: string;
          license?: string | null;
          owner_id?: string | null;
          share_token_hash?: string | null;
          source_area_id?: string | null;
          version?: number;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "published_knowledge_area_versions_forked_from_version_id_fkey";
            columns: ["forked_from_version_id"];
            isOneToOne: false;
            referencedRelation: "published_knowledge_area_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "published_knowledge_area_versions_source_area_id_fkey";
            columns: ["source_area_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_areas";
            referencedColumns: ["id"];
          },
        ];
      };
      review_events: {
        Row: {
          base_review_event_id: string | null;
          card_id: string;
          created_at: string;
          device_id: string;
          device_sequence: number;
          effective_reviewed_at: string;
          elapsed_ms: number | null;
          id: string;
          previous_state_hash: string | null;
          rating: string;
          received_at_server: string;
          reviewed_at_device: string;
          scheduler_family: string;
          scheduler_parameter_set_id: string | null;
          scheduler_version: string;
          user_id: string;
        };
        Insert: {
          base_review_event_id?: string | null;
          card_id: string;
          created_at?: string;
          device_id: string;
          device_sequence: number;
          effective_reviewed_at: string;
          elapsed_ms?: number | null;
          id: string;
          previous_state_hash?: string | null;
          rating: string;
          received_at_server?: string;
          reviewed_at_device: string;
          scheduler_family: string;
          scheduler_parameter_set_id?: string | null;
          scheduler_version: string;
          user_id: string;
        };
        Update: {
          base_review_event_id?: string | null;
          card_id?: string;
          created_at?: string;
          device_id?: string;
          device_sequence?: number;
          effective_reviewed_at?: string;
          elapsed_ms?: number | null;
          id?: string;
          previous_state_hash?: string | null;
          rating?: string;
          received_at_server?: string;
          reviewed_at_device?: string;
          scheduler_family?: string;
          scheduler_parameter_set_id?: string | null;
          scheduler_version?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_events_base_review_event_id_fkey";
            columns: ["base_review_event_id"];
            isOneToOne: false;
            referencedRelation: "review_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_user_id_card_id_base_review_event_id_fkey";
            columns: ["user_id", "card_id", "base_review_event_id"];
            isOneToOne: false;
            referencedRelation: "review_events";
            referencedColumns: ["user_id", "card_id", "id"];
          },
        ];
      };
      scheduling_state: {
        Row: {
          card_id: string;
          last_review_event_id: string | null;
          scheduler_family: string;
          scheduler_version: string;
          state: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          card_id: string;
          last_review_event_id?: string | null;
          scheduler_family: string;
          scheduler_version: string;
          state: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          card_id?: string;
          last_review_event_id?: string | null;
          scheduler_family?: string;
          scheduler_version?: string;
          state?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduling_state_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduling_state_user_id_card_id_last_review_event_id_fkey";
            columns: ["user_id", "card_id", "last_review_event_id"];
            isOneToOne: false;
            referencedRelation: "review_events";
            referencedColumns: ["user_id", "card_id", "id"];
          },
        ];
      };
      sync_changes: {
        Row: {
          created_at: string;
          entity_id: string;
          entity_type: string;
          operation: string;
          operation_id: string;
          payload: NonNullable<Json>;
          sequence: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          entity_id: string;
          entity_type: string;
          operation: string;
          operation_id: string;
          payload: NonNullable<Json>;
          sequence?: never;
          user_id: string;
        };
        Update: {
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          operation?: string;
          operation_id?: string;
          payload?: NonNullable<Json>;
          sequence?: never;
          user_id?: string;
        };
        Relationships: [];
      };
      tutor_ai_usage_events: {
        Row: {
          created_at: string;
          id: string;
          input_tokens: number | null;
          model: string;
          operation: string;
          output_tokens: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          input_tokens?: number | null;
          model: string;
          operation: string;
          output_tokens?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          input_tokens?: number | null;
          model?: string;
          operation?: string;
          output_tokens?: number | null;
          user_id?: string;
        };
        Relationships: [];
      };
      tutor_messages: {
        Row: {
          content: NonNullable<Json>;
          created_at: string;
          id: string;
          kind: string;
          role: string;
          sequence: number;
          session_id: string;
          user_id: string;
        };
        Insert: {
          content: NonNullable<Json>;
          created_at?: string;
          id: string;
          kind: string;
          role: string;
          sequence?: never;
          session_id: string;
          user_id: string;
        };
        Update: {
          content?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          kind?: string;
          role?: string;
          sequence?: never;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tutor_messages_user_id_session_id_fkey";
            columns: ["user_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "tutor_sessions";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
      tutor_sessions: {
        Row: {
          area_id: string;
          area_snapshot: NonNullable<Json>;
          area_title: string;
          created_at: string;
          id: string;
          last_observation_id: string | null;
          last_proposal_id: string | null;
          last_quiz: Json | null;
          state: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          area_id: string;
          area_snapshot: NonNullable<Json>;
          area_title: string;
          created_at?: string;
          id: string;
          last_observation_id?: string | null;
          last_proposal_id?: string | null;
          last_quiz?: Json | null;
          state?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          area_id?: string;
          area_snapshot?: NonNullable<Json>;
          area_title?: string;
          created_at?: string;
          id?: string;
          last_observation_id?: string | null;
          last_proposal_id?: string | null;
          last_quiz?: Json | null;
          state?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tutor_sessions_last_observation_owner_fk";
            columns: ["user_id", "last_observation_id"];
            isOneToOne: false;
            referencedRelation: "ai_observations";
            referencedColumns: ["user_id", "id"];
          },
          {
            foreignKeyName: "tutor_sessions_last_proposal_owner_fk";
            columns: ["user_id", "last_proposal_id"];
            isOneToOne: false;
            referencedRelation: "generated_card_proposals";
            referencedColumns: ["user_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      erase_account_data: { Args: { p_user_id: string }; Returns: boolean };
      manage_unlisted_knowledge_area_share_token: {
        Args: { p_action: string; p_share_token_hash?: string; p_version_id: string };
        Returns: boolean;
      };
      published_media_read_allowed: {
        Args: {
          p_media_id: string;
          p_owner_id: string;
          p_share_token_hash: string;
          p_version_id: string;
        };
        Returns: boolean;
      };
      read_unlisted_knowledge_area_version: {
        Args: { p_share_token_hash: string; p_version_id: string };
        Returns: {
          attribution: string;
          content: Json;
          content_hash: string;
          created_at: string;
          forked_from_version_id: string;
          id: string;
          license: string;
          source_area_id: string;
          version: number;
        }[];
      };
      read_unlisted_knowledge_area_version_for_media: {
        Args: { p_share_token_hash: string; p_version_id: string };
        Returns: {
          content: Json;
          content_hash: string;
          id: string;
          owner_id: string;
          visibility: string;
        }[];
      };
      record_tutor_ai_usage: {
        Args: { p_id: string; p_input_tokens: number; p_output_tokens: number };
        Returns: boolean;
      };
      reserve_tutor_ai_call: {
        Args: { p_id: string; p_model: string; p_operation: string };
        Returns: boolean;
      };
      resolve_card_proposal: {
        Args: { p_card_id?: string; p_content?: Json; p_proposal_id: string; p_state: string };
        Returns: boolean;
      };
      sync_workspace_content: { Args: { p_areas: Json; p_tombstones: Json }; Returns: boolean };
      tombstone_knowledge_areas: { Args: { p_area_tombstones: Json }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
