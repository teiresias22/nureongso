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

rollback;
