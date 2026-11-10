-- ETHAN PAY v4.0 — Neon PostgreSQL schema
-- The application server connects with DATABASE_URL. Do not expose this URL to browsers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.payment_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, full_name text NOT NULL, phone text,
 password_hash text NOT NULL, role text NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','customer')),
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.payment_service_catalog (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, description text,
 active boolean NOT NULL DEFAULT true, allowed_currencies text[] NOT NULL DEFAULT ARRAY['NGN','USD','GBP','EUR']::text[],
 display_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.payment_bank_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank_name text NOT NULL, account_name text NOT NULL, account_number text NOT NULL,
 currency text NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN','USD','GBP','EUR')), instructions text,
 is_active boolean NOT NULL DEFAULT true, display_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bank_name, account_number)
);
CREATE TABLE IF NOT EXISTS public.payment_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES public.payment_users(id),
 payer_name text NOT NULL, payer_email text NOT NULL, service_code text NOT NULL REFERENCES public.payment_service_catalog(code),
 service_name text NOT NULL, description text, amount numeric(14,2) NOT NULL CHECK (amount > 0),
 currency text NOT NULL CHECK (currency IN ('NGN','USD','GBP','EUR')), payment_method text NOT NULL DEFAULT 'manual_bank',
 status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending_review','verified','rejected','cancelled','refunded')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz, reviewed_by uuid REFERENCES public.payment_users(id), review_note text
);
CREATE TABLE IF NOT EXISTS public.payment_manual_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
 bank_account_id uuid NOT NULL REFERENCES public.payment_bank_accounts(id), bank_name text NOT NULL, account_number text NOT NULL,
 transfer_reference text NOT NULL, transfer_date date NOT NULL, note text, evidence_url text,
 submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by uuid REFERENCES public.payment_users(id), review_note text
);
CREATE TABLE IF NOT EXISTS public.payment_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id),
 receipt_number text NOT NULL UNIQUE, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.payment_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id),
 requested_by uuid NOT NULL REFERENCES public.payment_users(id), amount numeric(14,2) NOT NULL CHECK (amount > 0),
 reason text NOT NULL, status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','completed')),
 reviewed_by uuid REFERENCES public.payment_users(id), review_note text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.payment_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text NOT NULL UNIQUE, payer_name text NOT NULL, payer_email text NOT NULL,
 service_code text NOT NULL REFERENCES public.payment_service_catalog(code), service_name text NOT NULL, description text,
 amount numeric(14,2) NOT NULL CHECK (amount > 0), currency text NOT NULL CHECK (currency IN ('NGN','USD','GBP','EUR')),
 due_date date, status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','void')),
 created_by uuid NOT NULL REFERENCES public.payment_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES public.payment_users(id), action text NOT NULL,
 entity_type text NOT NULL, entity_id text, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_transactions_user_created_idx ON public.payment_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_transactions_status_created_idx ON public.payment_transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_manual_transfer_ref_idx ON public.payment_manual_submissions(transfer_reference);
CREATE INDEX IF NOT EXISTS payment_audit_created_idx ON public.payment_audit_log(created_at DESC);
INSERT INTO public.payment_service_catalog(code,name,description,display_order) VALUES
 ('LEARN','Ethan Learn','Course and professional learning payments',1),
 ('LMS','Ethan LMS & ERP','Academic and programme payments',2),
 ('STORE','Ethan Store','Store purchases and orders',3),
 ('CERT','Ethan Certificate','Certificate processing and issuance',4),
 ('ACADEMY','Ethan Digital Academy','Training, workshops and other academy services',5),
 ('OTHER','Other approved Ethan charge','Other approved ecosystem charges',6)
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.payment_bank_accounts(bank_name,account_name,account_number,currency,instructions,display_order) VALUES
 ('Kuda MFB','ALLONMAADIAH INTERNATIONAL LIMITED','3003847218','NGN','Official ETHAN DIGITALS payment account. Do not pay into personal accounts.',1),
 ('United Bank for Africa (UBA)','ALLON-MAADIAH INTERNATIONAL LIMITED','1021643438','NGN','Official ETHAN DIGITALS payment account. Do not pay into personal accounts.',2)
ON CONFLICT(bank_name,account_number) DO NOTHING;
ALTER TABLE public.payment_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_manual_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
-- No public/anonymous DB policies are created. All access is mediated by the authenticated server.
