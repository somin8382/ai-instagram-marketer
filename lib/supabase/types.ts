export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string | null;
          email: string | null;
          created_at: string | null;
          brand_name: string | null;
          marketing_channel: string | null;
          industry: string | null;
          product_service: string | null;
          account_onboarded_at: string | null;
          instagram_url: string | null;
          youtube_url: string | null;
          company_name: string | null;
          generation_prefs: Json | null;
        };
        Insert: {
          id: string;
          name?: string | null;
          email?: string | null;
          created_at?: string | null;
          brand_name?: string | null;
          marketing_channel?: string | null;
          industry?: string | null;
          product_service?: string | null;
          account_onboarded_at?: string | null;
          instagram_url?: string | null;
          youtube_url?: string | null;
          company_name?: string | null;
          generation_prefs?: Json | null;
        };
        Update: {
          id?: string;
          name?: string | null;
          email?: string | null;
          created_at?: string | null;
          brand_name?: string | null;
          marketing_channel?: string | null;
          industry?: string | null;
          product_service?: string | null;
          account_onboarded_at?: string | null;
          instagram_url?: string | null;
          youtube_url?: string | null;
          company_name?: string | null;
          generation_prefs?: Json | null;
        };
      };
      applications: {
        Row: {
          id: string;
          user_id: string | null;
          email: string | null;
          instagram_id: string | null;
          has_account: boolean | null;
          industry: string | null;
          product_service: string | null;
          marketing_channel: string | null;
          channel_url: string | null;
          main_content_url: string | null;
          comments_included: boolean | null;
          account_direction: string | null;
          account_bio: string | null;
          account_concept: string | null;
          selected_plan: number | null;
          selected_duration: number | null;
          is_express: boolean | null;
          completion_date: string | null;
          manager_name: string | null;
          phone: string | null;
          depositor_name: string | null;
          tax_invoice_requested: boolean | null;
          business_number: string | null;
          company_name: string | null;
          ceo_name: string | null;
          business_address: string | null;
          business_type: string | null;
          invoice_email: string | null;
          status: string | null;
          created_at: string | null;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      payments: {
        Row: {
          id: string;
          application_id: string | null;
          expected_amount: number | null;
          bank_name: string | null;
          account_number: string | null;
          account_holder: string | null;
          depositor_name: string | null;
          payment_status: string | null;
          confirmed_at: string | null;
          created_at: string | null;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      generated_posts: {
        Row: {
          id: string;
          application_id: string | null;
          user_id: string | null;
          title: string | null;
          content: string | null;
          hashtags: string | null;
          image_url: string | null;
          is_free_trial: boolean | null;
          created_at: string | null;
          overlay_text: string | null;
          overlay_style: Json | null;
          overlay_enabled: boolean | null;
          visual_prompt: string | null;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_type: string;
          start_date: string;
          end_date: string;
          remaining_credits: number;
          daily_usage_count: number;
          last_usage_date: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      credit_grants: {
        Row: {
          id: string;
          user_id: string;
          email: string | null;
          amount: number;
          reason: string | null;
          message: string | null;
          granted_by: string | null;
          created_at: string;
          confirmed: boolean;
          confirmed_at: string | null;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      generation_logs: {
        Row: {
          id: string;
          user_id: string | null;
          usage_mode: string;
          outcome: string;
          duration_ms: number | null;
          user_prompt: string | null;
          image_count: number;
          image_model: string | null;
          text_model: string | null;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      inquiries: {
        Row: {
          id: string;
          user_id: string;
          email: string | null;
          message: string;
          page_path: string | null;
          status: string;
          admin_reply: string | null;
          replied_by: string | null;
          replied_at: string | null;
          reply_read_at: string | null;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      outreach_messages: {
        Row: {
          id: string;
          channel: string;
          category: string;
          subject: string | null;
          body: string;
          created_by: string | null;
          total: number;
          sent: number;
          failed: number;
          skipped: number;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      outreach_sends: {
        Row: {
          id: string;
          message_id: string;
          channel: string;
          recipient_email: string | null;
          recipient_phone: string | null;
          recipient_name: string | null;
          status: string;
          error: string | null;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      outreach_optouts: {
        Row: {
          id: string;
          channel: string;
          email: string | null;
          phone: string | null;
          source: string | null;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      login_events: {
        Row: {
          id: string;
          user_id: string;
          email: string | null;
          event_type: string;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          email?: string | null;
          event_type?: string;
          occurred_at?: string;
        };
        Update: Record<string, Json | undefined>;
      };
      admin_user_notes: {
        Row: {
          email: string;
          note: string;
          toss_status: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      marketing_confirmations: {
        Row: {
          id: string;
          user_id: string;
          email: string | null;
          month: string;
          choice: string;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      monthly_channel_info: {
        Row: {
          id: string;
          user_id: string;
          email: string | null;
          month: string;
          marketing_channel: string | null;
          channel_url: string | null;
          instagram_id: string | null;
          main_content_url: string | null;
          comments_included: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      follower_snapshots: {
        Row: {
          id: string;
          email: string;
          platform: string;
          count: number;
          recorded_on: string;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
      service_grants: {
        Row: {
          id: string;
          email: string;
          applicant_name: string | null;
          phone: string | null;
          host_org: string | null;
          mentor_org: string | null;
          ai_marketer: boolean;
          ai_generator: boolean;
          marketer_quantity: number | null;
          marketer_months: string | null;
          generator_months: string | null;
          generator_credits: number;
          status: string;
          applied_user_id: string | null;
          created_at: string;
          applied_at: string | null;
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
    };
  };
};
