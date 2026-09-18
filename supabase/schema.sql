-- 누렁소검은소 schema
-- Supabase SQL Editor 에 통째로 붙여넣고 실행.

-- 의원 (역대 전체, MONA/NAAS 코드가 고유키)
create table if not exists member (
  code          text primary key,          -- MONA_CD / NAAS_CD
  name          text not null,
  name_hanja    text,
  birth         text,
  sex           text,
  party         text,                      -- 최신 정당
  district      text,                      -- 최신 지역구
  elect_type    text,                      -- 지역구 / 비례대표
  terms         text,                      -- "제21대, 제22대"
  term_count    text,                      -- 초선 / 재선 ...
  committees    text,
  photo_url     text,
  tel           text,
  email         text,
  homepage      text,
  is_incumbent  boolean not null default false,
  updated_at    timestamptz not null default now()
);
create index if not exists member_name_idx on member (name);
create index if not exists member_incumbent_idx on member (is_incumbent) where is_incumbent;

-- 법률안
create table if not exists bill (
  bill_id       text primary key,
  age           int not null,
  bill_no       text,
  name          text not null,
  committee     text,
  proposed_at   date,
  proc_result   text,                      -- 원안가결 / 수정가결 / 폐기 / null(계류)
  proc_dt       date,
  proposer      text,                      -- "홍길동의원 등 10인"
  detail_link   text,
  updated_at    timestamptz not null default now()
);
create index if not exists bill_age_idx on bill (age);
create index if not exists bill_proposed_idx on bill (proposed_at desc);

-- 발의 / 공동발의
create table if not exists bill_sponsor (
  bill_id     text not null references bill(bill_id) on delete cascade,
  member_code text not null,
  role        text not null check (role in ('rep','co')),
  primary key (bill_id, member_code, role)
);
create index if not exists bill_sponsor_member_idx on bill_sponsor (member_code, role);

-- 본회의 표결 (의원 x 의안)
create table if not exists vote (
  bill_id     text not null,
  member_code text not null,
  result      text not null,               -- 찬성 / 반대 / 기권 / 불참
  voted_at    timestamptz,
  primary key (bill_id, member_code)
);
create index if not exists vote_member_idx on vote (member_code);

-- 본회의 표결에 부쳐진 의안 (집계)
create table if not exists plenary_bill (
  bill_id     text primary key,
  age         int not null,
  bill_no     text,
  name        text,
  committee   text,
  proc_dt     date,
  proc_result text,
  yes_cnt     int, no_cnt int, blank_cnt int, vote_cnt int, member_cnt int
);

-- 역대 출마 이력 (선관위, Phase 2)
create table if not exists candidacy (
  id            bigserial primary key,
  member_code   text references member(code) on delete cascade,
  election_id   text,
  election_name text,
  sg_type       text,
  district      text,
  party         text,
  name          text,
  birth         text,
  votes         bigint,
  vote_rate     numeric,
  elected       boolean,
  unique (election_id, sg_type, district, name)
);
create index if not exists candidacy_member_idx on candidacy (member_code);

-- 공약 (Phase 3)
create table if not exists pledge_doc (
  id          bigserial primary key,
  member_code text references member(code) on delete cascade,
  election_id text,
  pdf_url     text,
  raw_text    text,
  parsed_at   timestamptz,
  unique (member_code, election_id)
);

create table if not exists pledge (
  id          bigserial primary key,
  doc_id      bigint references pledge_doc(id) on delete cascade,
  member_code text references member(code) on delete cascade,
  election_id text,
  order_no    int,
  title       text not null,
  body        text,
  category    text
);
create index if not exists pledge_member_idx on pledge (member_code);

-- 이행 판정 (Phase 4)
create table if not exists pledge_status (
  pledge_id   bigint primary key references pledge(id) on delete cascade,
  status      text not null check (status in ('완료','진행','미착수','판단불가')),
  confidence  numeric,
  decided_by  text not null default 'auto' check (decided_by in ('auto','reviewer')),
  note        text,
  updated_at  timestamptz not null default now()
);

create table if not exists pledge_evidence (
  id         bigserial primary key,
  pledge_id  bigint references pledge(id) on delete cascade,
  kind       text not null check (kind in ('bill','news','budget','manual')),
  ref_id     text,
  url        text,
  summary    text,
  score      numeric
);
create index if not exists pledge_evidence_pledge_idx on pledge_evidence (pledge_id);

-- 수집 로그
create table if not exists ingest_run (
  id         bigserial primary key,
  source     text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows       int,
  error      text
);

-- 의원별 요약 (목록 화면용). 수집 후 refresh.
create materialized view if not exists member_stats as
select
  m.code,
  count(*) filter (where s.role = 'rep')                      as rep_count,
  count(*) filter (where s.role = 'co')                       as co_count,
  count(*) filter (where s.role = 'rep' and b.proc_result like '%가결%') as rep_passed,
  (select count(*) from vote v where v.member_code = m.code and v.result <> '불참') as vote_attended,
  (select count(*) from vote v where v.member_code = m.code) as vote_total
from member m
left join bill_sponsor s on s.member_code = m.code
left join bill b on b.bill_id = s.bill_id
group by m.code;
create unique index if not exists member_stats_code_idx on member_stats (code);

-- materialized view 는 RLS 대상이 아니라 직접 권한 부여
grant select on member_stats to anon, authenticated;

-- 내부 테이블: 정책 없이 RLS 만 켜서 anon 접근을 전부 차단.
-- 수집기는 postgres 역할로 직접 접속하므로 RLS 를 우회한다.
alter table pledge_doc enable row level security;
alter table ingest_run enable row level security;

-- 공개 읽기 전용
alter table member enable row level security;
alter table bill enable row level security;
alter table bill_sponsor enable row level security;
alter table vote enable row level security;
alter table plenary_bill enable row level security;
alter table candidacy enable row level security;
alter table pledge enable row level security;
alter table pledge_status enable row level security;
alter table pledge_evidence enable row level security;

do $$
declare t text;
begin
  foreach t in array array['member','bill','bill_sponsor','vote','plenary_bill','candidacy','pledge','pledge_status','pledge_evidence']
  loop
    execute format('drop policy if exists public_read on %I', t);
    execute format('create policy public_read on %I for select using (true)', t);
  end loop;
end $$;
