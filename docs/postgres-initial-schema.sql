-- Quill Web App initial Postgres schema draft.
-- This is a design artifact, not yet an Alembic migration.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  display_name text,
  timezone text not null default 'America/Toronto',
  status text not null default 'active',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_status_check check (status in ('active', 'disabled', 'deleted'))
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_account_expires_idx on sessions(account_id, expires_at desc);
create index sessions_expires_idx on sessions(expires_at);

create table account_settings (
  account_id uuid primary key references accounts(id) on delete cascade,
  email_tone_rules text,
  daily_cost_cap_usd numeric(10,2) not null default 5.00,
  ui_density text not null default 'comfortable',
  batch_defaults jsonb not null default '{}'::jsonb,
  gmail_address citext,
  gmail_app_password_encrypted text,
  gmail_send_name text,
  gmail_last_verified_at timestamptz,
  reply_check_enabled boolean not null default false,
  reply_check_interval_hours integer not null default 4,
  reply_check_last_run_at timestamptz,
  reply_check_last_status jsonb,
  reply_check_last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_settings_daily_cost_check check (daily_cost_cap_usd >= 0),
  constraint account_settings_reply_interval_check check (reply_check_interval_hours between 1 and 168)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null,
  title text not null,
  storage_key text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  text text,
  extracted_json jsonb,
  is_default boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_account_kind_idx on documents(account_id, kind);
create index documents_account_default_idx on documents(account_id, is_default) where is_default = true;
create unique index documents_account_sha256_uidx on documents(account_id, sha256) where sha256 is not null;
create index documents_text_search_idx on documents using gin (to_tsvector('english', coalesce(text, '')));

create table profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references accounts(id) on delete cascade,
  name text not null default '',
  preferred_name text,
  pronouns text,
  headshot_url text,
  email citext,
  email_secondary citext,
  phone text,
  city text,
  country text,
  nationality text,
  languages jsonb,
  orcid text,
  scholar_url text,
  github text,
  linkedin text,
  website text,
  twitter text,
  current_role text,
  affiliation text,
  target_position_type text,
  target_start_date date,
  earliest_available_date date,
  target_countries jsonb,
  target_universities_preferred jsonb,
  excluded_institutions jsonb,
  funding_status text,
  work_authorization jsonb,
  commitment_length text,
  headline text,
  research_interests text,
  research_categories jsonb,
  methods jsonb,
  application_domains jsonb,
  tools_frameworks jsonb,
  datasets_used jsonb,
  datasets_created jsonb,
  programming_languages jsonb,
  certifications jsonb,
  reviewing_venues jsonb,
  teaching_summary text,
  phd_year integer,
  phd_institution text,
  cv_doc_id uuid references documents(id) on delete set null,
  research_statement_doc_id uuid references documents(id) on delete set null,
  transcript_doc_ids jsonb,
  sample_paper_doc_ids jsonb,
  field_provenance jsonb,
  cv_last_extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_research_categories_gin on profiles using gin (research_categories jsonb_path_ops);
create index profiles_methods_gin on profiles using gin (methods jsonb_path_ops);
create index profiles_domains_gin on profiles using gin (application_domains jsonb_path_ops);

create table profile_education (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  degree_level text not null,
  field text,
  institution text,
  department text,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  gpa numeric(5,2),
  gpa_scale numeric(5,2),
  honors text,
  advisor_name text,
  advisor_title text,
  co_advisor_name text,
  thesis_title text,
  thesis_abstract text,
  key_courses jsonb,
  transcript_doc_id uuid references documents(id) on delete set null,
  order_idx integer not null default 0
);
create index profile_education_profile_order_idx on profile_education(account_id, profile_id, order_idx);

create table profile_publications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  authors text,
  venue_full_name text,
  venue_short text,
  year integer,
  type text,
  status text default 'published',
  doi text,
  url text,
  pdf_url text,
  citation_count integer,
  your_role text,
  abstract text,
  one_line_takeaway text,
  is_signature boolean not null default false,
  order_idx integer not null default 0
);
create index profile_publications_profile_order_idx on profile_publications(account_id, profile_id, order_idx);
create index profile_publications_year_idx on profile_publications(account_id, year desc);
create index profile_publications_signature_idx on profile_publications(account_id, is_signature) where is_signature = true;

create table profile_experience (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  employer text,
  lab_or_group text,
  supervisor text,
  location text,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  bullets jsonb,
  tech_used jsonb,
  order_idx integer not null default 0
);
create index profile_experience_profile_order_idx on profile_experience(account_id, profile_id, order_idx);

create table profile_awards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  granting_body text,
  amount numeric(12,2),
  currency text default 'USD',
  year integer,
  type text,
  notes text,
  order_idx integer not null default 0
);
create index profile_awards_profile_order_idx on profile_awards(account_id, profile_id, order_idx);
create index profile_awards_year_idx on profile_awards(account_id, year desc);

create table profile_references (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  title text,
  institution text,
  email citext,
  relationship_type text,
  years_known integer,
  notes text,
  order_idx integer not null default 0
);
create index profile_references_profile_order_idx on profile_references(account_id, profile_id, order_idx);

create table professors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  number integer,
  name text not null,
  university text,
  dept_lab text not null default '',
  tier text not null default 'T3',
  status text not null default 'drafting',
  date_sent date,
  email citext,
  research_angle text,
  notes text,
  priority integer not null default 0,
  profile_url text,
  research_interests text,
  research_category text,
  scholar_url text,
  twitter text,
  lab_url text,
  last_research_summary text,
  research_summary_at timestamptz,
  auto_filled_at timestamptz,
  source text not null default 'manual',
  is_suggested boolean not null default false,
  dismissed_at timestamptz,
  match_score integer,
  position_type text,
  prospective_url text,
  hiring_signals jsonb,
  hiring_notes text,
  hiring_intel jsonb,
  contact_instructions text,
  profile_scraped_at timestamptz,
  relevance_score integer,
  relevance_breakdown jsonb,
  relevance_scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index professors_status_idx on professors(account_id, status);
create index professors_university_idx on professors(account_id, university);
create index professors_category_idx on professors(account_id, research_category);
create index professors_relevance_idx on professors(account_id, relevance_score desc nulls last);
create index professors_search_idx on professors using gin (
  to_tsvector('english', coalesce(name, '') || ' ' || coalesce(university, '') || ' ' || coalesce(research_interests, ''))
);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  workflow text not null,
  status text not null default 'queued',
  engine text,
  model text,
  prompt_hash text,
  prompt_text text,
  request_json jsonb,
  output text,
  error_type text,
  error_message text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(12,6),
  duration_ms integer,
  retry_of_run_id uuid references ai_runs(id) on delete set null,
  professor_id uuid references professors(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  grant_id uuid,
  draft_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index ai_runs_created_idx on ai_runs(account_id, created_at desc);
create index ai_runs_workflow_idx on ai_runs(account_id, workflow, created_at desc);
create index ai_runs_status_idx on ai_runs(account_id, status);
create index ai_runs_error_idx on ai_runs(account_id, error_type) where error_type is not null;

create table ai_run_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  run_id uuid not null references ai_runs(id) on delete cascade,
  seq integer not null,
  event_type text not null,
  message text,
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);
create index ai_run_events_run_idx on ai_run_events(account_id, run_id, seq);

create table ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  run_id uuid not null references ai_runs(id) on delete cascade,
  tool_name text not null,
  input jsonb,
  output jsonb,
  status text not null default 'running',
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_tool_calls_run_idx on ai_tool_calls(account_id, run_id, started_at);
create index ai_tool_calls_tool_idx on ai_tool_calls(account_id, tool_name, started_at desc);

create table email_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  professor_id uuid not null references professors(id) on delete cascade,
  subject text not null default '',
  body text not null default '',
  ai_generated boolean not null default false,
  ai_run_id uuid references ai_runs(id) on delete set null,
  version integer not null default 1,
  sent_via text,
  sent_at timestamptz,
  sent_message_id text,
  send_error text,
  skipped_at timestamptz,
  is_backup boolean not null default false,
  attachment_doc_ids jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_drafts_professor_idx on email_drafts(account_id, professor_id);
create index email_drafts_sent_idx on email_drafts(account_id, sent_at desc);
create unique index email_drafts_message_uidx on email_drafts(account_id, sent_message_id) where sent_message_id is not null;

alter table ai_runs add constraint ai_runs_draft_fk foreign key (draft_id) references email_drafts(id) on delete set null;

create table email_replies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  draft_id uuid not null references email_drafts(id) on delete cascade,
  professor_id uuid not null references professors(id) on delete cascade,
  received_at timestamptz not null,
  from_email citext,
  from_name text,
  subject text,
  snippet text,
  body text,
  message_id text,
  in_reply_to text,
  read_at timestamptz,
  dismissed_at timestamptz,
  response_draft text,
  response_subject text,
  response_sent_at timestamptz,
  response_message_id text,
  meeting_request boolean,
  meeting_intent_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_replies_received_idx on email_replies(account_id, received_at desc);
create index email_replies_professor_idx on email_replies(account_id, professor_id);
create unique index email_replies_message_uidx on email_replies(account_id, message_id) where message_id is not null;
create index email_replies_unread_idx on email_replies(account_id, read_at) where read_at is null;

create table grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  deadline text not null default '',
  amount text not null default '',
  eligibility text not null default '',
  status text not null default 'pending',
  notes text not null default '',
  url text not null default '',
  source text not null default 'manual',
  match_score integer,
  matched_reasons jsonb,
  region text,
  discipline_tags jsonb
);
alter table ai_runs add constraint ai_runs_grant_fk foreign key (grant_id) references grants(id) on delete set null;
create index grants_status_idx on grants(account_id, status);
create index grants_match_idx on grants(account_id, match_score desc nulls last);

create table applications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  professor_id uuid references professors(id) on delete set null,
  title text not null,
  deadline date,
  status text not null default 'planning',
  portal_url text,
  notes text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index applications_status_idx on applications(account_id, status);
create index applications_deadline_idx on applications(account_id, deadline);

create table recommenders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  email citext,
  relationship text,
  affiliation text,
  notes text,
  created_at timestamptz not null default now()
);

create table application_recommenders (
  application_id uuid not null references applications(id) on delete cascade,
  recommender_id uuid not null references recommenders(id) on delete cascade,
  letter_status text not null default 'asked',
  letter_due_date date,
  last_nudge_sent_at timestamptz,
  notes text,
  primary key (application_id, recommender_id)
);

create table professor_papers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  professor_id uuid not null references professors(id) on delete cascade,
  title text not null,
  venue text,
  year integer,
  abstract text,
  url text,
  pdf_url text,
  s2_id text,
  relevance_score integer,
  relevance_summary text,
  fetched_at timestamptz not null default now()
);
create index professor_papers_professor_year_idx on professor_papers(account_id, professor_id, year desc);
create unique index professor_papers_s2_uidx on professor_papers(account_id, professor_id, s2_id) where s2_id is not null;

create table interview_prep (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  professor_id uuid not null references professors(id) on delete cascade,
  reply_id uuid references email_replies(id) on delete set null,
  position_type text,
  meeting_format text not null default 'formal_interview',
  meeting_at timestamptz,
  meeting_notes text,
  briefing text,
  fit_analysis text,
  talking_points jsonb,
  likely_questions jsonb,
  questions_to_ask jsonb,
  logistics jsonb,
  status text not null default 'draft',
  ai_run_id uuid references ai_runs(id) on delete set null,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index interview_prep_professor_idx on interview_prep(account_id, professor_id);
create index interview_prep_status_idx on interview_prep(account_id, status);

create table mock_interviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  prep_id uuid not null references interview_prep(id) on delete cascade,
  transcript jsonb,
  status text not null default 'active',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index mock_interviews_prep_idx on mock_interviews(account_id, prep_id);

create table activities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  date date not null default current_date,
  action text not null,
  detail text not null default '',
  professor_id uuid references professors(id) on delete set null,
  created_at timestamptz not null default now()
);
create index activities_created_idx on activities(account_id, created_at desc);
create index activities_professor_idx on activities(account_id, professor_id, created_at desc);

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null,
  date date not null,
  time text,
  end_time text,
  description text,
  color text,
  kind text not null default 'event',
  all_day boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_events_date_idx on calendar_events(account_id, date);
create index calendar_events_kind_date_idx on calendar_events(account_id, kind, date);

create table migration_id_map (
  table_name text not null,
  old_id integer not null,
  new_id uuid not null,
  primary key (table_name, old_id)
);
