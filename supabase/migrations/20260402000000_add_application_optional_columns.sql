alter table public.applications
  add column if not exists has_account boolean;

alter table public.applications
  add column if not exists account_direction text;

alter table public.applications
  add column if not exists account_bio text;

alter table public.applications
  add column if not exists account_concept text;

alter table public.applications
  add column if not exists tax_invoice_requested boolean;

alter table public.applications
  add column if not exists business_number text;

alter table public.applications
  add column if not exists company_name text;

alter table public.applications
  add column if not exists ceo_name text;

alter table public.applications
  add column if not exists business_address text;

alter table public.applications
  add column if not exists business_type text;

alter table public.applications
  add column if not exists invoice_email text;
