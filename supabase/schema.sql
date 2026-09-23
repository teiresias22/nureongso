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
  kind       text not null check (kind in ('bill','ordin','bid','news','budget','manual')),
  ref_id     text,
  url        text,
  summary    text,
  score      numeric
);
create index if not exists pledge_evidence_pledge_idx on pledge_evidence (pledge_id);
create unique index if not exists pledge_evidence_key
  on pledge_evidence (pledge_id, kind, ref_id);

-- 선거공보 원문 PDF 주소만 밖으로 낸다.
--
-- pledge_doc 자체는 내부 테이블이다(RLS 켜고 정책 없음). raw_text 에 공보 PDF 를
-- 통째로 뽑은 글이 들어 있어서, 테이블을 열면 anon 이 그걸 다 긁어갈 수 있다.
-- 공보 자체는 공개 자료지만 우리 대역폭으로 퍼줄 이유는 없다.
--
-- 그래서 security_invoker 를 켜지 않는다. 뷰 소유자 권한으로 돌아 RLS 를 지나가고,
-- 내보내는 칸은 아래 다섯 개뿐이다. 다른 뷰(bill_sponsor_member 등)가 invoker 인 것은
-- 그쪽 원본 테이블에 public_read 정책이 있기 때문이고, 여기는 그게 없다.
create or replace view pledge_doc_link as
select id, member_code, election_id, kind, pdf_url
from pledge_doc where pdf_url is not null;
grant select on pledge_doc_link to anon, authenticated;

-- 자치법규(조례·규칙). 조례제도형 공약의 근거다 — 법안이 입법형의 근거인 것과 같다.
-- 전국 것을 통째로 받되 취임일 이후만 받는다. 전 기간을 받으면 40만 행이지만
-- 임기 중 제·개정만 그 사람의 실적이고, 그건 4년에 20만 행 남짓이다.
create table if not exists ordinance (
  id            text primary key,       -- 자치법규일련번호 (본문 주소의 키)
  ordin_id      text,                   -- 자치법규ID (개정돼도 유지되는 식별자)
  name          text not null,
  org           text,                   -- 지자체기관명 '서울특별시 강남구'
  kind          text,                   -- 조례 / 규칙
  rr_kind       text,                   -- 제정 / 일부개정 / 전부개정 / 폐지
  effective_at  text,                   -- YYYYMMDD
  announced_at  text,
  url           text
);
create index if not exists ordinance_org_idx on ordinance (org);
-- 공약 제목과 조례명을 유사도로 맞춘다. 이름이 짧고 문어체라 법안보다 잘 맞는다.
create index if not exists ordinance_name_trgm on ordinance using gin (name gin_trgm_ops);

-- 나라장터 공사 입찰공고. 예산사업형 공약의 근거다.
--
-- 발주는 '그 사업이 진행됐다' 는 사실이지 '이 사람이 해냈다' 가 아니다. 국회의원에게는
-- 예산 편성권이 없고, 단체장 공약도 전임자가 이미 추진하던 사업일 수 있다. 그래서
-- 화면 문구는 '사업 진행 상태' 이고, 판정에서 이 근거는 '완료' 를 만들지 않는다.
--
-- 예산 1억 이상, 우리가 다루는 지자체 발주만 담는다. 하한 없이 전국을 다 받으면
-- 4년에 27만 행이다 (실측 추산). budget_biz 를 163MB 때문에 뺀 적이 있어 미리 자른다.
create table if not exists bid_notice (
  id          text primary key,      -- 공고번호-차수
  name        text not null,         -- 공고명
  org         text,                  -- 이 사업의 주인으로 본 지자체 (수요/공고 중 하나)
  demand_org  text,                  -- 수요기관
  notice_org  text,                  -- 공고기관
  notice_at   date,
  budget      bigint,                -- 예산금액(원)
  region      text,                  -- 공사현장 지역
  url         text                   -- 나라장터 공고 원문
);
create index if not exists bid_notice_org_idx on bid_notice (org);
create index if not exists bid_notice_name_trgm on bid_notice using gin (name gin_trgm_ops);

-- 국회의원 지역구 → 공사현장 지역. bid.py link 가 채운다.
--
-- 지역구는 시군구보다 작거나(강남구갑/을/병) 여러 시군구를 묶는다(춘천시철원군
-- 화천군양구군). 공사현장은 시군구까지만 나오므로 시군구 단위로 잇는다.
--
-- **이 표로는 귀속을 말할 수 없다.** 한 시군구를 둘 이상이 나눠 갖는 의원이
-- 253명 중 168명(66%)이다. 수원시 공사 하나가 수원 의원 5명에게 똑같이 붙는다.
-- 그래서 이행 판정에는 쓰지 않고 '그 지역에서 무엇이 발주됐나' 만 보여준다.
create table if not exists member_sigungu (
  member_code text not null references member(code) on delete cascade,
  region      text not null,
  primary key (member_code, region)
);

-- 지역구별 발주 공사. 화면은 이 뷰를 member_code 로만 읽는다.
--
-- 같은 공사가 여러 번 공고된다. 차수가 올라가는 변경공고(000/001/002)와, 유찰 뒤
-- 번호까지 새로 받는 재공고가 있다. 27,384행 중 3,731행(14%)이 이렇게 겹친다 —
-- 화면에 그대로 내면 백석국민체육센터가 두 줄로 보인다. 기관·공고명·금액이 같으면
-- 한 공사로 보고 **처음 공고된 날**만 남긴다.
create or replace view member_district_bid
with (security_invoker = true) as
select s.member_code, b.id, b.name, b.org, b.budget, b.notice_at, b.region, b.url
from member_sigungu s
join (
  select distinct on (org, name, budget) *
  from bid_notice order by org, name, budget, notice_at
) b on b.region = s.region;
grant select on member_district_bid to anon, authenticated;

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
  -- 법안 관련 수치는 note 문자열이 아니라 근거(pledge_evidence)에서 직접 센다.
  -- note 로 세면 판정 규칙을 고칠 때마다 조용히 틀어진다. 실제로 그랬다 — 유형이
  -- 섞인 공약이 'partial:...' 로 바뀌면서 'law_passed' 만 보던 집계에서 빠졌다.
  select pl.member_code,
    count(*)                                        as pledge_count,
    count(*) filter (where st.status = '완료')       as pledge_done,
    count(*) filter (where st.pledge_id is not null) as pledge_judged,
    count(*) filter (where '입법' = any(pl.kinds))   as pledge_law,
    count(*) filter (where '입법' = any(pl.kinds) and ev.n > 0)      as pledge_law_filed,
    count(*) filter (where '입법' = any(pl.kinds) and ev.passed)     as pledge_law_passed
  from pledge pl
  left join pledge_status st on st.pledge_id = pl.id
  left join (
    -- judge.py 의 decide 와 같은 조건이어야 한다. 약속보다 먼저 낸 법안은 세지 않는다.
    -- 여기만 빠뜨리면 화면 숫자와 판정이 어긋난다.
    select e.pledge_id, count(*) as n,
           bool_or(b.proc_result like '%가결%') as passed
    from pledge_evidence e
    join pledge p0 on p0.id = e.pledge_id
    join bill b on b.bill_id = e.ref_id
                and b.proposed_at >= to_date(p0.election_id, 'YYYYMMDD')
    where e.kind = 'bill' group by e.pledge_id
  ) ev on ev.pledge_id = pl.id
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

-- 같은 선거구에 함께 나온 두 후보의 공약이 같은 것을 약속하는 쌍.
--
-- 한 지역에 나온 후보들의 공약은 비슷비슷하다. 유권자가 '누가 무엇을 다르게 약속했나'
-- 를 보려면 무엇이 같은지 먼저 갈라 줘야 한다.
--
-- 공약서(대표공약)끼리만 본다. 당선인은 선거공보 전체 공약도 있지만 낙선자는 공약서
-- 5~10개뿐이라 섞으면 비교가 기울어진다. 국회의원은 아예 대상이 아니다 — 선관위가
-- 선거 후 당선인 공약만 남겨 낙선자 것을 구할 수 없다.
--
-- a < b 로 한 번만 둔다. 방향이 없는 관계라 두 줄로 두면 화면에서 두 번 센다.
create table if not exists pledge_overlap (
  a        bigint references pledge(id) on delete cascade,
  b        bigint references pledge(id) on delete cascade,
  score    numeric,               -- LLM confidence 0~1
  summary  text,                  -- 무엇이 같은지 한 줄
  -- 겹친 내용이 확인할 수 있을 만큼 구체적인가. false 면 화면에 내보내지 않는다.
  -- 구청장 후보는 대표공약 5개에 경제·복지·교통을 통째로 담는 일이 많아, 표어끼리
  -- 붙으면 '살기 좋은 수영구' 와 '건강도시 수영' 이 이어진다. 읽는 사람이 새로 아는
  -- 게 없다. confidence 로는 안 갈린다 — 0.85 이상에도 표어끼리가 섞여 있었다.
  specific boolean
  primary key (a, b)
);
create index if not exists pledge_overlap_b_idx on pledge_overlap (b);

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
alter table ordinance enable row level security;
alter table bid_notice enable row level security;
alter table member_sigungu enable row level security;
alter table pledge_overlap enable row level security;

do $$
declare t text;
begin
  foreach t in array array['member','bill','bill_sponsor','vote','plenary_bill','candidacy','pledge','pledge_status','pledge_evidence','election','sg_type','ordinance','bid_notice','member_sigungu','pledge_overlap']
  loop
    execute format('drop policy if exists public_read on %I', t);
    execute format('create policy public_read on %I for select using (true)', t);
  end loop;
end $$;

-- 지방재정365 세부사업별 세출현황(budget_biz)은 뺐다.
--
-- 한 회계연도가 47만 행 / 163MB 라 Supabase 무료 500MB 를 거의 다 먹는다 (실측:
-- 271MB → 434MB). 대는 값이 그만큼 안 나왔다 — 사업명 유사도로는 '노인 보청기' 와
-- '노인 성인용 보행기' 가 구별되지 않아 완도군 표본에서 후보 14건 중 6건만 맞았다.
--
-- 되살리려면: collector/budget.py 가 그대로 있고, 아래 DDL 을 되살리면 된다.
-- git log 에서 "지방재정365 세부사업별 세출현황 수집기" 커밋을 보면 전체가 있다.
-- 용량이 모자라면 budget.py --min 100000000 (1억 이상만; 사업 수 43%, 금액 97%).

-- 비어 있는 국회의원 지역구. 선관위 당선 기록과 국회 현역 명부를 대조해 센다.
--
-- 왜 필요한가: 22대 정원은 300명인데 현역 API 는 299명을 준다. 화면에 299 만
-- 나오면 읽는 사람이 '1명이 어디 갔지' 에서 막힌다 (실측: 권성동 의원이 2026-06-18
-- 표결을 끝으로 명부에서 빠졌고, 강릉시는 2026-06-03 재보궐 대상이 아니었다).
--
-- 정원 300 을 코드에 박지 않는다. 선거법이 바뀌면 틀어진다. 대신 최근 총선의
-- 지역구 수를 세어 모집단으로 쓴다.
--
-- 국회의원만 본다. 단체장·교육감은 현역 명부를 주는 API 가 없어서, 임기 중
-- 사퇴·구속으로 자리가 비어도 우리 쪽에서는 알 방법이 없다.
-- 비례대표도 뺀다. 승계 순번으로 채워져 '빈 지역구' 라는 개념이 없다.
create or replace view vacant_seat
with (security_invoker = true) as
with gen as (
  -- 가장 최근 '총선'. 재보궐에는 비례대표 선거(7)가 없다는 점으로 가른다.
  -- 최신 선거를 그냥 쓰면 재보궐(14곳)이 잡혀 모집단이 통째로 틀어진다.
  select max(election_id) as id from candidacy where sg_typecode = '7' and elected
), seat as (
  select c.sd_name, c.district from candidacy c cross join gen
  where c.sg_typecode = '2' and c.elected and c.election_id = gen.id
), holder as (
  -- 선거구마다 가장 최근 당선자. 그 뒤의 재보궐 당선자가 있으면 그 사람이다.
  select distinct on (s.sd_name, s.district)
         s.sd_name, s.district, c.name, c.party, c.election_id, c.member_code
  from seat s
  cross join gen
  join candidacy c on c.sg_typecode = '2' and c.elected
       and c.sd_name = s.sd_name and c.district = s.district
       and c.election_id >= gen.id
  order by s.sd_name, s.district, c.election_id desc
)
select h.sd_name, h.district, h.name as last_name, h.party as last_party,
       h.election_id as last_election
from holder h
left join member m on m.code = h.member_code
where not coalesce(m.is_incumbent, false) or m.office is distinct from '국회의원';

grant select on vacant_seat to anon, authenticated;
