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
        };
        Insert: {
          id: string;
          name?: string | null;
          email?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string | null;
          email?: string | null;
          created_at?: string | null;
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
        };
        Insert: Record<string, Json | undefined>;
        Update: Record<string, Json | undefined>;
      };
    };
  };
};
