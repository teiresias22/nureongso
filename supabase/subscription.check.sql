-- 구독 표·함수 점검. 운영 DB 하나뿐이라 begin … rollback 안에서만 돈다 — 남는 것이 없다.
-- 실행(collector 에서):
--   dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('subscription.check ok')"
-- 또는 SQL Editor 에 통째로 붙여 실행. assert 가 틀리면 그 문장에서 멈춘다.
-- schema.sql 의 '주간 기록 메일'·'공약 판정 이력' 덩어리를 적용한 뒤에만 돈다(적용 전이면 표가 없다고 실패한다).
-- 실제 구독자가 지난 한 시간에 확인 메일을 30통 넘게 받았다면 2) 가 subscription_busy 로 실패한다(그때는 한 시간 뒤 다시).
begin;

-- 1) anon(공개 키)은 구독 표를 읽지도 쓰지도, 함수를 부르지도 못한다
insert into subscriber (email, sd_name, wiw_name) values ('check-rls@example.com', '서울특별시', '종로구');
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from subscriber;
  exception when insufficient_privilege then n := 0;
  end;
  assert n = 0, 'anon 이 subscriber 를 읽었다';
  begin
    select count(*) into n from digest_log;
  exception when insufficient_privilege then n := 0;
  end;
  assert n = 0, 'anon 이 digest_log 를 읽었다';
  begin
    insert into subscriber (email, sd_name) values ('anon@example.com', '서울특별시');
    raise exception 'anon 이 subscriber 에 썼다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform subscription_request('anon@example.com', '서울특별시', '');
    raise exception 'anon 이 subscription_request() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform subscription_confirm('00000000-0000-0000-0000-000000000000');
    raise exception 'anon 이 subscription_confirm() 을 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform subscription_stop('00000000-0000-0000-0000-000000000000');
    raise exception 'anon 이 subscription_stop() 을 불렀다';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 2) 신청: 새 주소는 토큰, 10분 안에 다시 누르면 null(지역만 바뀐다), 10분 뒤엔 같은 토큰을 다시
do $$
declare t1 uuid; t2 uuid; t3 uuid;
begin
  t1 := subscription_request('  Check-New@Example.com ', '대구광역시', '서구');
  assert t1 is not null, '새 주소에 토큰이 없다';
  assert (select email from subscriber where token = t1) = 'check-new@example.com', '주소를 소문자·공백 제거로 두지 않았다';
  t2 := subscription_request('check-new@example.com', '대구광역시', '달서구');
  assert t2 is null, '10분 안에 확인 메일을 또 보낸다';
  assert (select wiw_name from subscriber where token = t1) = '달서구', '확인 전에는 지역을 바꿀 수 있어야 한다';
  update subscriber set confirm_sent_at = now() - interval '11 minutes' where token = t1;
  t3 := subscription_request('check-new@example.com', '대구광역시', '서구');
  assert t3 = t1, '10분 뒤 다시 보낼 때 토큰이 바뀌었다';
end $$;

-- 3) 확인: 없는 토큰·7일 지난 링크는 안 되고, 맞는 토큰은 된다. 확인된 주소는 신청으로 바뀌지 않는다
do $$
declare t uuid;
begin
  t := (select token from subscriber where email = 'check-new@example.com');
  assert not subscription_confirm(gen_random_uuid()), '없는 토큰으로 확인됐다';
  update subscriber set confirm_sent_at = now() - interval '8 days' where token = t;
  assert not subscription_confirm(t), '7일 지난 링크로 확인됐다';
  update subscriber set confirm_sent_at = now() where token = t;
  assert subscription_confirm(t), '맞는 토큰으로 확인되지 않았다';
  assert (select confirmed_at from subscriber where token = t) is not null, 'confirmed_at 이 비었다';
  assert subscription_confirm(t), '두 번 눌러도 확인 상태여야 한다';
  assert subscription_request('check-new@example.com', '서울특별시', '종로구') is null, '확인된 주소에 또 확인 메일을 보낸다';
  assert (select sd_name from subscriber where token = t) = '대구광역시', '남이 확인된 구독의 지역을 바꿨다';
end $$;

-- 4) 해지: 행을 지우고 발송 기록도 함께 지운다. 두 번째는 false
do $$
declare t uuid; sid bigint;
begin
  select token, id into t, sid from subscriber where email = 'check-new@example.com';
  insert into digest_log (subscriber_id, week, sent) values (sid, date '2026-10-12', true);
  assert subscription_stop(t), '해지되지 않았다';
  assert not exists (select 1 from subscriber where token = t), '해지 뒤에도 주소가 남았다';
  assert not exists (select 1 from digest_log where subscriber_id = sid), '해지 뒤에도 발송 기록이 남았다';
  assert not subscription_stop(t), '없는 구독을 해지했다고 한다';
end $$;

-- 5) 한 시간에 확인 메일 30통이 넘으면 subscription_busy
do $$
begin
  insert into subscriber (email, sd_name, confirm_sent_at)
  select 'check-busy-' || i || '@example.com', '서울특별시', now() from generate_series(1, 30) i;
  begin
    perform subscription_request('check-late@example.com', '서울특별시', '');
    raise exception '한도를 넘었는데 받았다';
  exception when raise_exception then
    assert sqlerrm = 'subscription_busy', sqlerrm;
  end;
end $$;

-- 6) anon 은 주간 처리 함수도 부르지 못한다(digest_due 는 메일 주소를 돌려준다)
set local role anon;
do $$
begin
  begin
    perform digest_due(current_date);
    raise exception 'anon 이 digest_due() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform digest_changes(array['x'], now(), now());
    raise exception 'anon 이 digest_changes() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 7) 주마다 한 번: 그 주가 시작되기 전에 확인한 사람만, digest_log 에 적힌 사람은 빼고
do $$
declare a bigint; b bigint; c bigint; n int; wk date := date '2026-10-12';
begin
  insert into subscriber (email, sd_name, confirmed_at)
    values ('check-due-a@example.com', '서울특별시', timestamptz '2026-10-11 23:59+09') returning id into a;
  insert into subscriber (email, sd_name, confirmed_at)
    values ('check-due-b@example.com', '서울특별시', timestamptz '2026-10-12 00:00+09') returning id into b;
  insert into subscriber (email, sd_name) values ('check-due-c@example.com', '서울특별시') returning id into c;
  assert exists (select 1 from digest_due(wk) where id = a), '월요일 전에 확인한 사람이 빠졌다';
  assert not exists (select 1 from digest_due(wk) where id = b), '그 주에 확인한 사람이 들어갔다';
  assert not exists (select 1 from digest_due(wk) where id = c), '확인 안 한 사람이 들어갔다';
  insert into digest_log (subscriber_id, week, sent) values (a, wk, true);
  assert not exists (select 1 from digest_due(wk) where id = a), '이미 처리한 사람을 또 집었다';
  -- digest.py 가 기대는 것: 같은 (사람, 주) 를 두 번 적으면 두 번째는 아무것도 돌려주지 않는다
  insert into digest_log (subscriber_id, week, sent) values (a, wk, true) on conflict do nothing returning 1 into n;
  assert n is null, '같은 주를 두 번 적었다';
  assert exists (select 1 from digest_due(wk + 7) where id = a), '다음 주에는 다시 받아야 한다';
end $$;

-- 8) 새 기록: 기간 안에 수집된 것만, 대표발의만, 표결은 결과별 건수, 끝 시각은 다음 주 몫
do $$
declare f timestamptz := now() - interval '1 day'; t timestamptz := now() + interval '1 day'; pid bigint;
begin
  insert into member (code, name) values ('ZZCHECK1', '점검용');
  insert into bill (bill_id, age, name, created_at) values
    ('ZZB-NEW', 22, '새 법안', now()),
    ('ZZB-OLD', 22, '지난주 법안', now() - interval '8 days'),
    ('ZZB-CO', 22, '공동발의 법안', now());
  insert into bill_sponsor (bill_id, member_code, role) values
    ('ZZB-NEW', 'ZZCHECK1', 'rep'), ('ZZB-OLD', 'ZZCHECK1', 'rep'), ('ZZB-CO', 'ZZCHECK1', 'co');
  insert into vote (bill_id, member_code, result, created_at) values
    ('ZZB-NEW', 'ZZCHECK1', '찬성', now()), ('ZZB-CO', 'ZZCHECK1', '찬성', now()),
    ('ZZB-OLD', 'ZZCHECK1', '반대', now() - interval '8 days');
  insert into attendance (age, name, member_code, session_no, days, present, created_at)
    values (99, '점검용', 'ZZCHECK1', 430, 10, 9, now());
  insert into pledge (member_code, title, order_no) values ('ZZCHECK1', '점검 공약', 1) returning id into pid;
  -- 공약은 판정 이력(pledge_status_log, 트리거)에서 상태가 실제로 바뀐 줄만 — 첫 판정(기준선)은 아니다.
  insert into pledge_status (pledge_id, status, note) values (pid, '판단불가', 'none_early');
  update pledge_status set status = '미착수', note = 'none_2y' where pledge_id = pid;

  assert (select count(*) from digest_changes(array['ZZCHECK1'], f, t) where kind = 'bill') = 1, '새 대표발의가 하나가 아니다';
  assert (select data->>'bill_id' from digest_changes(array['ZZCHECK1'], f, t) where kind = 'bill') = 'ZZB-NEW', '공동발의나 지난주 법안이 섞였다';
  assert (select (data->>'n')::int from digest_changes(array['ZZCHECK1'], f, t)
          where kind = 'vote' and data->>'result' = '찬성') = 2, '찬성이 2건이 아니다';
  assert not exists (select 1 from digest_changes(array['ZZCHECK1'], f, t)
                     where kind = 'vote' and data->>'result' = '반대'), '기간 밖 표결이 들어왔다';
  assert (select data->>'session_no' from digest_changes(array['ZZCHECK1'], f, t) where kind = 'attendance') = '430', '출결 누적이 없다';
  assert (select data->>'status' || '|' || (data->>'prev') || '|' || (data->>'decided_by') from digest_changes(array['ZZCHECK1'], f, t)
          where kind = 'pledge') = '미착수|판단불가|auto', '공약 판정 변화가 없다';
  assert not exists (select 1 from digest_changes(array['ZZCHECK1'], now() - interval '2 days', now())
                     where kind = 'bill'), '기간 끝 시각에 들어온 기록이 이번 주에 들어왔다';
  assert not exists (select 1 from digest_changes(array['ZZ-NOBODY'], f, t)), '다른 사람 기록이 나왔다';
end $$;

-- 9) 칸을 더하기 전부터 있던 행은 '-infinity' — 칸을 더한 주에 법안 전부가 '새 기록' 이 되지 않는다
--    (기존 행이 있는 DB — 운영 — 에서만 참이다. 빈 DB 에서 돌릴 때는 첫 assert 를 뺀다)
do $$
begin
  assert (select count(*) from bill where created_at = '-infinity') > 0, '기존 법안이 -infinity 가 아니다';
  insert into bill (bill_id, age, name) values ('ZZB-DEF', 22, '기본값');
  assert (select created_at from bill where bill_id = 'ZZB-DEF') = now(), '새 법안의 created_at 이 now() 가 아니다';
end $$;

rollback;
