
-- ETHAN PAY v3.0 — Supabase-ready backend schema
-- Run in the Ethan Pay Supabase project when ready.
create extension if not exists pgcrypto;

create table if not exists public.ethan_pay_transactions (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  user_id uuid,
  payer_name text,
  payer_email text,
  service_code text,
  service_name text not null,
  description text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('NGN','USD','GBP','EUR')),
  payment_method text not null default 'manual_bank',
  provider text,
  provider_reference text,
  status text not null default 'pending'
    check (status in ('draft','pending','under_review','verified','failed','rejected','cancelled','refunded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid
);

create table if not exists public.ethan_pay_manual_submissions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ethan_pay_transactions(id) on delete cascade,
  bank_name text,
  transfer_reference text not null,
  transfer_date date,
  note text,
  evidence_path text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text
);

create table if not exists public.ethan_pay_receipts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid unique not null references public.ethan_pay_transactions(id) on delete cascade,
  receipt_number text unique not null,
  issued_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb
);

create table if not exists public.ethan_pay_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ethan_pay_transactions(id),
  amount numeric(14,2) not null check(amount > 0),
  reason text not null,
  status text not null default 'requested'
    check(status in ('requested','approved','rejected','completed')),
  requested_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ethan_pay_audit_log (
  id bigint generated always as identity primary key,
  transaction_id uuid,
  actor_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ethan_pay_service_catalog (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  description text,
  active boolean not null default true,
  allowed_currencies text[] not null default array['NGN','USD','GBP','EUR'],
  created_at timestamptz not null default now()
);

insert into public.ethan_pay_service_catalog(code,name,description) values
 ('LEARN','Ethan Learn','Academic learning payments'),
 ('LMS','Ethan LMS & ERP','Course and programme payments'),
 ('STORE','Ethan Store','Store order payments'),
 ('CERT','Ethan Certificate','Certificate-related payments'),
 ('OTHER','Other Approved Charge','Other approved Ethan charges')
on conflict (code) do nothing;

create or replace function public.ethan_pay_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

drop trigger if exists trg_ethan_pay_updated_at on public.ethan_pay_transactions;
create trigger trg_ethan_pay_updated_at before update on public.ethan_pay_transactions
for each row execute function public.ethan_pay_set_updated_at();

-- RLS enabled now; policies should be connected to Ethan ID roles during ecosystem integration.
alter table public.ethan_pay_transactions enable row level security;
alter table public.ethan_pay_manual_submissions enable row level security;
alter table public.ethan_pay_receipts enable row level security;
alter table public.ethan_pay_refunds enable row level security;
alter table public.ethan_pay_audit_log enable row level security;
alter table public.ethan_pay_service_catalog enable row level security;

-- Public may read active service names only. No public transaction writes are granted.
drop policy if exists "read active Ethan Pay services" on public.ethan_pay_service_catalog;
create policy "read active Ethan Pay services" on public.ethan_pay_service_catalog
for select using (active = true);

-- IMPORTANT:
-- Do not add anonymous insert/update/delete policies for transactions.
-- Ethan ID authenticated-user/admin policies are added during SSO integration.
