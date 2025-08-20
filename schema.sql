-- ============ Grundkonfiguration ============
-- Achtung: Ohne Login -> RLS AUS (öffentlich). Für Produktion später absichern.
-- (Supabase hat standardmäßig RLS an; wir deaktivieren es hier pro Tabelle nach dem Anlegen.)

-- ============ Hilfstabellen ============
create table if not exists income_categories (
  id bigserial primary key,
  name text unique not null
);

create table if not exists expense_categories (
  id bigserial primary key,
  name text unique not null
);

insert into income_categories(name)
values ('Photography'),('Videography'),('Webdesign'),('Retainer'),('Licensing'),('Other')
on conflict do nothing;

insert into expense_categories(name)
values ('Equipment'),('Software'),('Marketing'),('Travel'),('Subscriptions'),('Taxes/Fees'),('Other')
on conflict do nothing;

-- ============ Kunden ============
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  email text,
  phone text,
  billing_address text,
  vat_number text
);

create index if not exists idx_clients_name on clients using gin (to_tsvector('simple', coalesce(name,'')));

create or replace function trg_clients_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists t_clients_updated on clients;
create trigger t_clients_updated before update on clients
for each row execute function trg_clients_updated_at();

-- ============ Projekte ============
do $$ begin
  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type project_status as enum ('planned','in_progress','completed','cancelled');
  end if;
end $$;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  client_id uuid references clients(id) on delete set null,
  start_date date,
  end_date date,
  status project_status default 'planned'::project_status,
  budget_chf numeric(12,2),
  notes text
);

create index if not exists idx_projects_client on projects(client_id);
create index if not exists idx_projects_status on projects(status);

create or replace function trg_projects_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists t_projects_updated on projects;
create trigger t_projects_updated before update on projects
for each row execute function trg_projects_updated_at();

-- ============ Dokumente (Offerten & Rechnungen) ============
do $$ begin
  if not exists (select 1 from pg_type where typname = 'document_type') then
    create type document_type as enum ('quote','invoice','credit_note');
  end if;
  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type document_status as enum ('draft','sent','accepted','rejected','overdue','paid','cancelled');
  end if;
end $$;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  doc_type document_type not null,
  doc_number text unique,                    -- auto-Nummer via Trigger
  client_id uuid references clients(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  issue_date date not null default current_date,
  due_date date,
  status document_status default 'draft'::document_status,
  currency text not null default 'CHF',
  notes text,
  subtotal numeric(12,2) default 0,
  tax_rate numeric(5,2) default 0,          -- z.B. 8.10
  tax_total numeric(12,2) generated always as (round(subtotal * tax_rate / 100.0, 2)) stored,
  total numeric(12,2) generated always as (round(subtotal + tax_total, 2)) stored,
  paid_total numeric(12,2) default 0,
  balance numeric(12,2) generated always as (round(total - paid_total, 2)) stored
);

create table if not exists document_items (
  id bigserial primary key,
  document_id uuid references documents(id) on delete cascade,
  position int not null default 1,
  description text not null,
  qty numeric(12,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_tax_rate numeric(5,2),
  line_total numeric(12,2) generated always as (
    round(qty * unit_price, 2)
  ) stored
);

create index if not exists idx_document_items_doc on document_items(document_id);

-- Auto-Nummerierung: INV-YYYY-####, OFF-YYYY-####, CRN-YYYY-####
create table if not exists document_counters (
  year int not null,
  doc_type document_type not null,
  last_seq int not null default 0,
  primary key (year, doc_type)
);

create or replace function next_document_number(p_type document_type)
returns text language plpgsql as $$
declare
  y int := extract(year from current_date);
  seq int;
  prefix text;
begin
  insert into document_counters(year, doc_type, last_seq)
  values (y, p_type, 0)
  on conflict (year, doc_type) do nothing;

  update document_counters
  set last_seq = last_seq + 1
  where year = y and doc_type = p_type
  returning last_seq into seq;

  prefix := case p_type
              when 'invoice' then 'INV'
              when 'quote' then 'OFF'
              when 'credit_note' then 'CRN'
            end;

  return format('%s-%s-%04s', prefix, y, seq);
end $$;

create or replace function trg_documents_autonumber()
returns trigger language plpgsql as $$
begin
  if new.doc_number is null then
    new.doc_number := next_document_number(new.doc_type);
  end if;
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists t_documents_insupd on documents;
create trigger t_documents_insupd
before insert or update on documents
for each row execute function trg_documents_autonumber();

-- Rechen-Trigger: subtotal aus Positionen updaten
create or replace function recompute_document_subtotal(p_doc uuid)
returns void language sql as $$
update documents d
set subtotal = coalesce((
  select round(sum(line_total),2) from document_items di where di.document_id = d.id
),0)
where d.id = p_doc;
$$;

create or replace function trg_document_items_agg()
returns trigger language plpgsql as $$
begin
  perform recompute_document_subtotal(coalesce(new.document_id, old.document_id));
  return null;
end $$;

drop trigger if exists t_docitems_aiud on document_items;
create trigger t_docitems_aiud
after insert or update or delete on document_items
for each row execute function trg_document_items_agg();

-- ============ Einnahmen / Ausgaben ============
do $$ begin
  if not exists (select 1 from pg_type where typname = 'receipt_status') then
    create type receipt_status as enum ('open','paid','overdue','cancelled');
  end if;
end $$;

create table if not exists incomes (
  id bigserial primary key,
  created_at timestamptz default now(),
  tx_date date not null,
  month text generated always as (to_char(tx_date, 'YYYY-MM')) stored,
  project_id uuid references projects(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  description text,
  category_id bigint references income_categories(id) on delete set null,
  amount_chf numeric(12,2) not null check (amount_chf >= 0),
  status receipt_status default 'paid'::receipt_status,
  document_id uuid references documents(id) on delete set null
);

create index if not exists idx_incomes_month on incomes(month);
create index if not exists idx_incomes_project on incomes(project_id);

create table if not exists expenses (
  id bigserial primary key,
  created_at timestamptz default now(),
  tx_date date not null,
  month text generated always as (to_char(tx_date, 'YYYY-MM')) stored,
  project_id uuid references projects(id) on delete set null,
  vendor text,
  description text,
  category_id bigint references expense_categories(id) on delete set null,
  amount_chf numeric(12,2) not null check (amount_chf >= 0)
);

create index if not exists idx_expenses_month on expenses(month);
create index if not exists idx_expenses_project on expenses(project_id);

-- ============ Zahlungen auf Rechnungen (optional, für Teilzahlungen) ============
create table if not exists payments (
  id bigserial primary key,
  created_at timestamptz default now(),
  document_id uuid references documents(id) on delete cascade,
  pay_date date not null default current_date,
  method text,
  amount_chf numeric(12,2) not null check (amount_chf > 0)
);

create or replace function trg_documents_paid_total()
returns trigger language plpgsql as $$
begin
  update documents d
  set paid_total = coalesce((
    select round(sum(amount_chf),2) from payments p where p.document_id = d.id
  ),0)
  where d.id = coalesce(new.document_id, old.document_id);
  return null;
end $$;

drop trigger if exists t_payments_aiud on payments;
create trigger t_payments_aiud
after insert or update or delete on payments
for each row execute function trg_documents_paid_total();

-- ============ Kalender / Events ============
do $$ begin
  if not exists (select 1 from pg_type where typname = 'event_status') then
    create type event_status as enum ('planned','confirmed','done','cancelled');
  end if;
end $$;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  project_id uuid references projects(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  status event_status default 'planned'::event_status,
  location text
);

create index if not exists idx_events_start on events(start_at);

-- ============ Views fürs Dashboard ============
create or replace view v_monthly_overview as
select
  m::date as month_start,
  to_char(m::date, 'YYYY-MM') as month_key,
  coalesce((select sum(amount_chf) from incomes i where i.month = to_char(m::date,'YYYY-MM')),0)::numeric(12,2) as income_chf,
  coalesce((select sum(amount_chf) from expenses e where e.month = to_char(m::date,'YYYY-MM')),0)::numeric(12,2) as expense_chf,
  (coalesce((select sum(amount_chf) from incomes i where i.month = to_char(m::date,'YYYY-MM')),0)
  -coalesce((select sum(amount_chf) from expenses e where e.month = to_char(m::date,'YYYY-MM')),0))::numeric(12,2) as profit_chf
from generate_series(
  date_trunc('year', now())::date,
  (date_trunc('year', now()) + interval '11 months')::date,
  interval '1 month'
) as m;

create or replace view v_projects_financials as
select
  p.id,
  p.name,
  p.status,
  p.client_id,
  coalesce((select sum(i.amount_chf) from incomes i where i.project_id = p.id),0)::numeric(12,2) as income_chf,
  coalesce((select sum(e.amount_chf) from expenses e where e.project_id = p.id),0)::numeric(12,2) as expense_chf,
  (coalesce((select sum(i.amount_chf) from incomes i where i.project_id = p.id),0)
   - coalesce((select sum(e.amount_chf) from expenses e where e.project_id = p.id),0))::numeric(12,2) as profit_chf
from projects p;

create or replace view v_upcoming_events as
select *
from events
where start_at >= now()
order by start_at asc
limit 50;

-- ============ RLS aus (ohne Login) ============
alter table clients disable row level security;
alter table projects disable row level security;
alter table documents disable row level security;
alter table document_items disable row level security;
alter table document_counters disable row level security;
alter table incomes disable row level security;
alter table expenses disable row level security;
alter table payments disable row level security;
alter table events disable row level security;
alter table income_categories disable row level security;
alter table expense_categories disable row level security;

-- ============ Indizes für Performance ============
create index if not exists idx_incomes_date on incomes(tx_date);
create index if not exists idx_expenses_date on expenses(tx_date);
create index if not exists idx_documents_client on documents(client_id);
create index if not exists idx_documents_project on documents(project_id);
create index if not exists idx_documents_type on documents(doc_type);
