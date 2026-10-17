-- 공약 판정 이력(pledge_status_log 트리거)·근거 버전 점검. begin … rollback 안에서만 돈다 — 남는 것이 없다.
-- 실행(collector 에서, schema.sql '공약 판정 이력·근거 원문' 덩어리를 적용한 뒤):
--   dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/pledge_history.check.sql').read()); print('pledge_history.check ok')"
-- 또는 SQL Editor 에 통째로 붙여 실행. assert 가 틀리면 그 문장에서 멈춘다.
begin;

-- 1) 사유 일곱 가지 중 여섯: 기준선 → (신뢰도만: 줄 없음) → 기간 경과 → 근거 연결 → 원천 변화 → (판만 바뀜: input) → 규칙 판 적용 → 검수
select set_config('judge.rule', 'v1', true);
do $$
declare pid bigint;
  last_reason text;
begin
  insert into member (code, name) values ('ZZHIST1', '점검용');
  insert into pledge (member_code, title, order_no) values ('ZZHIST1', '점검 공약', 1) returning id into pid;

  insert into pledge_status (pledge_id, status, note) values (pid, '판단불가', 'none_early');
  assert (select reason from pledge_status_log where pledge_id = pid order by id desc limit 1) = 'baseline', '첫 판정이 기준선이 아니다';

  update pledge_status set confidence = 0.5 where pledge_id = pid;
  assert (select count(*) from pledge_status_log where pledge_id = pid) = 1, '신뢰도만 바뀌었는데 이력이 생겼다';

  update pledge_status set status = '미착수', note = 'none_2y' where pledge_id = pid;
  select reason into last_reason from pledge_status_log where pledge_id = pid order by id desc limit 1;
  assert last_reason = 'elapsed', '임기 2년 경과가 elapsed 가 아니다: ' || last_reason;
  assert (select prev_status from pledge_status_log where pledge_id = pid order by id desc limit 1) = '판단불가', 'prev_status 가 비었다';

  insert into bill (bill_id, age, name) values ('ZZB-H1', 22, '점검 법안');
  insert into source_version (kind, ref_id, content_hash, facts) values ('bill', 'ZZB-H1', 'h1', '{}');
  insert into pledge_evidence (pledge_id, kind, ref_id) values (pid, 'bill', 'ZZB-H1');
  update pledge_status set status = '진행', note = 'law_filed' where pledge_id = pid;
  select reason into last_reason from pledge_status_log where pledge_id = pid order by id desc limit 1;
  assert last_reason = 'evidence', '근거가 붙었는데 evidence 가 아니다: ' || last_reason;
  assert (select cardinality(versions) from pledge_status_log where pledge_id = pid order by id desc limit 1) = 1, '버전이 안 남았다';

  insert into source_version (kind, ref_id, content_hash, facts) values ('bill', 'ZZB-H1', 'h2', '{"proc_result": "대안반영폐기"}');
  update pledge_status set note = 'law_alt_unverified' where pledge_id = pid;
  select reason into last_reason from pledge_status_log where pledge_id = pid order by id desc limit 1;
  assert last_reason = 'source', '같은 근거의 새 버전이 source 가 아니다: ' || last_reason;

  -- (a) 판 이름만 바뀌고 실행 맥락이 없으면 규칙 변경으로 보지 않는다(입력 변화)
  perform set_config('judge.rule', 'v2', true);
  update pledge_status set note = 'law_filed' where pledge_id = pid;
  select reason into last_reason from pledge_status_log where pledge_id = pid order by id desc limit 1;
  assert last_reason = 'input', 'judge.reason 없이 판만 바뀌었는데 input 이 아니다: ' || last_reason;

  -- (b) 규칙 판 적용 실행(decide --rule)의 변화는 rule, 칸에는 그 판
  perform set_config('judge.rule', 'v3', true);
  perform set_config('judge.reason', 'rule', true);
  update pledge_status set note = 'law_alt_unverified' where pledge_id = pid;
  assert (select rule || '|' || reason from pledge_status_log where pledge_id = pid order by id desc limit 1) = 'v3|rule',
    '규칙 판 적용이 v3|rule 이 아니다';

  -- (c) 검수 실행이면 decided_by 가 auto 여도 reviewer
  perform set_config('judge.reason', 'reviewer', true);
  update pledge_status set note = 'law_filed' where pledge_id = pid;
  select reason into last_reason from pledge_status_log where pledge_id = pid order by id desc limit 1;
  assert last_reason = 'reviewer', '검수 실행이 reviewer 가 아니다: ' || last_reason;
  perform set_config('judge.reason', '', true);

  update pledge_status set decided_by = 'reviewer', status = '완료', note = null where pledge_id = pid;
  select reason into last_reason from pledge_status_log where pledge_id = pid order by id desc limit 1;
  assert last_reason = 'reviewer', '검수가 reviewer 가 아니다: ' || last_reason;
end $$;

-- 1-1) 기준선(rule null)에서 첫 규칙 적용이 rule, none_early → none_partial 은 기간 경과
do $$
declare pid bigint; q bigint;
begin
  insert into pledge (member_code, title, order_no) values ('ZZHIST1', '점검 공약 3', 3) returning id into pid;
  perform set_config('judge.rule', '', true);
  insert into pledge_status (pledge_id, status, note) values (pid, '판단불가', 'none_early');
  update pledge_status_log set rule = null where pledge_id = pid;   -- 운영 기준선처럼
  perform set_config('judge.rule', 'v4', true);
  perform set_config('judge.reason', 'rule', true);
  update pledge_status set note = 'not_checked' where pledge_id = pid;
  assert (select reason from pledge_status_log where pledge_id = pid order by id desc limit 1) = 'rule',
    '기준선 rule null 에서 첫 규칙 적용이 rule 이 아니다';
  perform set_config('judge.reason', '', true);

  insert into pledge (member_code, title, order_no) values ('ZZHIST1', '점검 공약 4', 4) returning id into q;
  insert into pledge_status (pledge_id, status, note) values (q, '판단불가', 'none_early');
  update pledge_status set note = 'none_partial' where pledge_id = q;
  assert (select reason from pledge_status_log where pledge_id = q order by id desc limit 1) = 'elapsed',
    'none_early → none_partial 이 elapsed 가 아니다';
end $$;

-- 2) 판 없이(SQL Editor) 고친 판정은 rule = 'manual', 사유는 입력 변화
select set_config('judge.rule', '', true);
do $$
declare pid bigint;
begin
  insert into pledge (member_code, title, order_no) values ('ZZHIST1', '점검 공약 2', 2) returning id into pid;
  insert into pledge_status (pledge_id, status, note) values (pid, '판단불가', 'not_checked');
  update pledge_status set note = 'none_early' where pledge_id = pid;
  assert (select rule || '|' || reason from pledge_status_log where pledge_id = pid order by id desc limit 1) = 'manual|input',
    '판 없이 고친 판정이 manual|input 이 아니다';
end $$;

-- 3) anon 은 이력·버전을 읽을 수 있고, 내부 함수는 부르지 못한다
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from pledge_status_log;
  select count(*) into n from source_version;
  select count(*) into n from bill_alt;
  begin
    perform pledge_versions(1);
    raise exception 'anon 이 pledge_versions() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
