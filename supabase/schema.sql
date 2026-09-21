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
  office        text not null default '국회의원',   -- 국회의원 / 시도지사 / 교육감 ...
  is_incumbent  boolean not null default false,
  updated_at    timestamptz not null default now()
);
create index if not exists member_office_idx on member (office) where is_incumbent;
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
  summary       text,                      -- 제안이유·주요내용 (BPMBILLSUMMARY 원문)
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
create index if not exists bill_sponsor_bill_idx on bill_sponsor (bill_id);

-- bill_sponsor.member_code 에는 외래키가 없어(수집 순서 때문) PostgREST 가 member 를
-- 임베드하지 못한다. 법안 상세의 발의자 목록이 비지 않도록 조인 뷰를 둔다.
create or replace view bill_sponsor_member
with (security_invoker = true) as
select s.bill_id, s.role, m.code, m.name, m.party, m.district, m.office, m.is_incumbent
from bill_sponsor s join member m on m.code = s.member_code;
grant select on bill_sponsor_member to anon, authenticated;

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

-- 선관위 선거 목록 (getCommonSgCodeList). sg_id = 선거일 YYYYMMDD.
create table if not exists election (
  sg_id       text not null,
  sg_typecode text not null,
  name        text,
  vote_date   date,
  office      text,
  primary key (sg_id, sg_typecode)
);

-- 선거종류코드. data.nec.go.kr LOD 전수 대조로 확인.
-- has_pledge_api = 선거공약서 제출 대상이라 공약이 API 로 내려오는 직위.
create table if not exists sg_type (
  code   text primary key,
  office text not null,
  has_pledge_api boolean not null default false
);
insert into sg_type (code, office, has_pledge_api) values
  ('1','대통령',true), ('2','국회의원',false), ('3','시도지사',true),
  ('4','구시군의장',true), ('5','시도의원',false), ('6','구시군의원',false),
  ('7','국회의원비례대표',false), ('8','시도의원비례대표',false),
  ('9','구시군의원비례대표',false), ('10','교육의원',false), ('11','교육감',true)
on conflict (code) do update
  set office = excluded.office, has_pledge_api = excluded.has_pledge_api;

-- 출마 이력 (선관위 당선인/후보자 API)
create table if not exists candidacy (
  id            bigserial primary key,
  member_code   text references member(code) on delete cascade,
  election_id   text,                      -- sgId
  sg_typecode   text,
  office        text,
  huboid        text,                      -- 선관위 후보자 고유키
  election_name text,
  district      text,                      -- sggName
  sd_name       text,
  wiw_name      text,
  party         text,
  name          text,
  birth         text,
  giho          text,
  votes         bigint,
  vote_rate     numeric,
  job           text,
  edu           text,
  career        text,
  elected       boolean
);
create index if not exists candidacy_member_idx on candidacy (member_code);
create unique index if not exists candidacy_nec_key
  on candidacy (election_id, sg_typecode, huboid);   -- 부분 인덱스면 ON CONFLICT 가 추론 못 한다

-- 공약 (Phase 3)
create table if not exists pledge_doc (
  id          bigserial primary key,
  member_code text references member(code) on delete cascade,
  election_id text,
  kind        text not null default '선거공보',  -- 공약서 | 선거공보
  pdf_url     text,
  raw_text    text,
  parsed_at   timestamptz
);
create unique index if not exists pledge_doc_key
  on pledge_doc (member_code, election_id, kind);

create table if not exists pledge (
  id          bigserial primary key,
  doc_id      bigint references pledge_doc(id) on delete cascade,
  member_code text references member(code) on delete cascade,
  election_id text,
  order_no    int,
  title       text not null,
  body        text,
  category    text,                      -- 주제 (교통·복지 ...)
  source      text,                      -- 공약서 | 선거공보
  -- 무엇을 보면 이행을 확인할 수 있는가. 주제가 아니라 '확인 수단'.
  -- 한국 공약은 한 항목에 여러 수단을 묶어서 배열이어야 한다.
  kinds       text[]                     -- 입법 | 예산사업 | 조례제도 | 선언 | 기타
);
create index if not exists pledge_member_idx on pledge (member_code);
create index if not exists pledge_source_idx on pledge (member_code, source);
create index if not exists pledge_kinds_idx on pledge using gin (kinds);

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
create unique index if not exists pledge_evidence_key
  on pledge_evidence (pledge_id, kind, ref_id);

-- 수집 로그
create table if not exists ingest_run (
  id         bigserial primary key,
  source     text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows       int,
  error      text
);

-- 의원별 요약. 수집 후 `ingest.py refresh` 로 갱신한다.
--
-- 집계는 반드시 여기(SQL)에서 한다. PostgREST 는 한 번에 최대 1000행만 반환하므로
-- 화면에서 행을 받아 세면 1000건이 넘는 의원의 수치가 조용히 잘린다.
create materialized view if not exists member_stats as
select
  m.code,
  m.is_incumbent,
  m.office,
  coalesce(s.rep_count, 0)   as rep_count,
  coalesce(s.co_count, 0)    as co_count,
  coalesce(s.rep_passed, 0)  as rep_passed,
  coalesce(s.rep_pending, 0) as rep_pending,
  coalesce(v.vote_total, 0)  as vote_total,
  coalesce(v.vote_yes, 0)    as vote_yes,
  coalesce(v.vote_no, 0)     as vote_no,
  coalesce(v.vote_blank, 0)  as vote_blank,
  coalesce(v.vote_absent, 0) as vote_absent,
  coalesce(p.pledge_count, 0)  as pledge_count,
  coalesce(p.pledge_done, 0)   as pledge_done,
  coalesce(p.pledge_judged, 0) as pledge_judged,
  coalesce(p.pledge_law, 0)    as pledge_law,
  coalesce(p.pledge_law_filed, 0)  as pledge_law_filed,
  coalesce(p.pledge_law_passed, 0) as pledge_law_passed
from member m
left join (
  select s.member_code,
    count(*) filter (where s.role = 'rep')                                as rep_count,
    count(*) filter (where s.role = 'co')                                 as co_count,
    count(*) filter (where s.role = 'rep' and b.proc_result like '%가결%') as rep_passed,
    count(*) filter (where s.role = 'rep' and b.proc_result is null)      as rep_pending
  from bill_sponsor s join bill b on b.bill_id = s.bill_id
  group by s.member_code
) s on s.member_code = m.code
left join (
  select member_code,
    count(*)                               as vote_total,
    count(*) filter (where result = '찬성') as vote_yes,
    count(*) filter (where result = '반대') as vote_no,
    count(*) filter (where result = '기권') as vote_blank,
    count(*) filter (where result = '불참') as vote_absent
  from vote group by member_code
) v on v.member_code = m.code
left join (
  select pl.member_code,
    count(*)                                        as pledge_count,
    count(*) filter (where st.status = '완료')       as pledge_done,
    count(*) filter (where st.pledge_id is not null) as pledge_judged,
    count(*) filter (where '입법' = any(pl.kinds))   as pledge_law,
    count(*) filter (where '입법' = any(pl.kinds)
                       and st.note in ('law_filed','law_passed'))  as pledge_law_filed,
    count(*) filter (where st.note = 'law_passed')  as pledge_law_passed
  from pledge pl left join pledge_status st on st.pledge_id = pl.id
  group by pl.member_code
) p on p.member_code = m.code;
create unique index if not exists member_stats_code_idx on member_stats (code);
create index if not exists member_stats_incumbent_idx on member_stats (is_incumbent) where is_incumbent;

-- 의원별 법안 목록을 정렬·제한해서 뽑기 위한 조인 뷰.
create or replace view member_bill
with (security_invoker = true) as
select s.member_code, s.role, b.bill_id, b.bill_no, b.name, b.committee,
       b.proposed_at, b.proc_result, b.proposer, b.detail_link
from bill_sponsor s join bill b on b.bill_id = s.bill_id;

-- materialized view 는 RLS 대상이 아니라 직접 권한 부여
grant select on member_stats to anon, authenticated;
grant select on member_bill to anon, authenticated;

-- 시도는 선관위 sd_name 이 정확하다. member.district 는 '서울 강서구병' 처럼
-- 시군구까지 붙어 있고 역대 값이 슬래시로 이어져 오기도 한다.
create or replace view member_region
with (security_invoker = true) as
select m.code, m.office, m.party, m.is_incumbent,
  case
    when c.sd_name = '전국' then '비례대표'
    when c.sd_name is not null then
      case regexp_replace(c.sd_name, '(특별자치시|특별자치도|특별시|광역시|자치도)$', '')
        when '경상남도' then '경남' when '경상북도' then '경북'
        when '전라남도' then '전남' when '전라북도' then '전북'
        when '충청남도' then '충남' when '충청북도' then '충북'
        when '경기도'   then '경기' when '강원도'   then '강원'
        when '제주도'   then '제주'
        else regexp_replace(c.sd_name, '(특별자치시|특별자치도|특별시|광역시|자치도|도)$', '')
      end
    when m.district = '비례대표' then '비례대표'
    else coalesce(nullif(split_part(split_part(m.district, '/', -1), ' ', 1), ''), '미상')
  end as region
from member m
left join lateral (
  select sd_name from candidacy c
  where c.member_code = m.code and c.elected and c.sd_name is not null
  order by c.election_id desc limit 1
) c on true;

-- 정당별 / 지역별 집계. 같은 컬럼 구성이라 화면에서 한 컴포넌트로 다룬다.
create or replace view party_stats
with (security_invoker = true) as
select r.office,
  -- 역대 정당이 '/' 로 이어져 오면 가장 최근 것만 쓴다.
  -- 안 그러면 '더불어민주당', '더불어민주당/더불어민주당' 이 따로 집계된다.
  split_part(r.party, '/', array_length(string_to_array(r.party, '/'), 1)) as name,
  count(*) as members,
  sum(s.rep_count) as rep_count, sum(s.co_count) as co_count,
  sum(s.rep_passed) as rep_passed, sum(s.vote_total) as vote_total,
  sum(s.vote_total - s.vote_absent) as vote_attended,
  sum(s.pledge_count) as pledge_count, sum(s.pledge_law) as pledge_law,
  sum(s.pledge_law_filed) as pledge_law_filed, sum(s.pledge_law_passed) as pledge_law_passed
from member_region r join member_stats s on s.code = r.code
where r.is_incumbent and r.party is not null
group by r.office, split_part(r.party, '/', array_length(string_to_array(r.party, '/'), 1));

create or replace view region_stats
with (security_invoker = true) as
select r.office, r.region as name, count(*) as members,
  sum(s.rep_count) as rep_count, sum(s.co_count) as co_count,
  sum(s.rep_passed) as rep_passed, sum(s.vote_total) as vote_total,
  sum(s.vote_total - s.vote_absent) as vote_attended,
  sum(s.pledge_count) as pledge_count, sum(s.pledge_law) as pledge_law,
  sum(s.pledge_law_filed) as pledge_law_filed, sum(s.pledge_law_passed) as pledge_law_passed
from member_region r join member_stats s on s.code = r.code
where r.is_incumbent
group by r.office, r.region;

-- 선수(몇 선)와 득표율. 국회의원은 열린국회정보가 term_count 를 주지만
-- 단체장·교육감은 없어서 선관위 당선 이력을 센다.
-- is_current 가 없으면 역대 당선인까지 2,400행이 넘어 PostgREST 1000행 상한에 걸린다.
create or replace view member_office_term
with (security_invoker = true) as
select
  c.member_code, c.office,
  count(*)                                        as wins,
  bool_or(m.is_incumbent and m.office = c.office) as is_current,
  max(c.election_id)                              as last_election,
  (array_agg(c.vote_rate order by c.election_id desc))[1] as last_vote_rate,
  (array_agg(c.district  order by c.election_id desc))[1] as last_district,
  min(c.election_id)                              as first_election
from candidacy c join member m on m.code = c.member_code
where c.elected and c.office is not null
group by c.member_code, c.office;

-- 지역으로 대표를 찾는 길(`/my`). member.district 는 직위마다 모양이 달라 못 쓴다
-- (국회의원 '대구 북구을', 시도지사 '대구광역시', 구시군의장 '검단구'). 특히 구시군의장의
-- '광주시' 는 경기 광주시인데 광주광역시와 구별이 안 된다. 선관위가 주는 sd_name/wiw_name
-- 만이 시도·시군구가 분리된 깨끗한 키다.
-- 현직으로 좁히는 이유: 역대까지 넣으면 2,285행이라 PostgREST 1000행 상한에 조용히 잘린다.
create or replace view member_area
with (security_invoker = true) as
select distinct on (c.member_code)
  c.member_code, coalesce(m.office, c.office) as office, c.sd_name, c.wiw_name
from candidacy c join member m on m.code = c.member_code and m.is_incumbent
-- 국회의원 출신 단체장이 의원 시절 지역구로 잡히지 않게 현재 직위의 당선만 본다.
where c.elected and c.office = coalesce(m.office, c.office)
order by c.member_code, c.election_id desc;

grant select on member_region, party_stats, region_stats, member_office_term, member_area
  to anon, authenticated;


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
alter table election enable row level security;
alter table sg_type enable row level security;

do $$
declare t text;
begin
  foreach t in array array['member','bill','bill_sponsor','vote','plenary_bill','candidacy','pledge','pledge_status','pledge_evidence','election','sg_type']
  loop
    execute format('drop policy if exists public_read on %I', t);
    execute format('create policy public_read on %I for select using (true)', t);
  end loop;
end $$;
