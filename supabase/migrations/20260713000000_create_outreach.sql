-- Admin outreach to not-yet-signed-up (pre-registration / 미가입) users.
-- Service-role only (all access via /api/admin/outreach); RLS on with no
-- policies except a public opt-out insert path (see below).

-- One row per campaign (subject/body/channel/category/admin + rollup counts).
create table if not exists public.outreach_messages (
  id           uuid        primary key default gen_random_uuid(),
  channel      text        not null check (channel in ('email','sms','alimtalk')),
  category     text        not null default 'notice' check (category in ('notice','ad')),
  subject      text,
  body         text        not null,
  created_by   text,       -- admin email
  total        integer     not null default 0,
  sent         integer     not null default 0,
  failed       integer     not null default 0,
  skipped      integer     not null default 0,
  created_at   timestamptz not null default timezone('utc', now())
);

-- One row per recipient send attempt (partial-failure friendly).
create table if not exists public.outreach_sends (
  id              uuid        primary key default gen_random_uuid(),
  message_id      uuid        not null references public.outreach_messages(id) on delete cascade,
  channel         text        not null,
  recipient_email text,
  recipient_phone text,
  recipient_name  text,
  status          text        not null check (status in ('sent','failed','skipped')),
  error           text,
  created_at      timestamptz not null default timezone('utc', now())
);

create index if not exists outreach_sends_message_id_idx
  on public.outreach_sends (message_id, created_at);

-- Opt-out list (email/phone), consulted before every send.
create table if not exists public.outreach_optouts (
  id         uuid        primary key default gen_random_uuid(),
  channel    text        not null check (channel in ('email','sms','alimtalk','all')),
  email      text,
  phone      text,
  source     text,       -- 'unsubscribe_link' | 'admin' | 'sms_reply'
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists outreach_optouts_email_idx on public.outreach_optouts (lower(email));
create index if not exists outreach_optouts_phone_idx on public.outreach_optouts (phone);

alter table public.outreach_messages enable row level security;
alter table public.outreach_sends    enable row level security;
alter table public.outreach_optouts  enable row level security;
-- No policies: service role (admin routes + signed unsubscribe route) only.
