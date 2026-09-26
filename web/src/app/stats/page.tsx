import Link from "next/link";
import { db, partyColor, pct, type GroupRecord, type GroupStats } from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "정당·지역별 통계",
  alternates: { canonical: "/stats" },
  description: "정당과 지역에 따라 의정활동·출결·재산 같은 공개 기록이 어떻게 다른지 비교합니다.",
};

type SP = { office?: string; by?: string };

/** 이보다 작은 묶음은 1인당 값이 사실상 한 사람 기록이라 흐리게 두고 주석을 단다. */
const SMALL_GROUP = 3;

export default async function StatsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { office = "국회의원", by = "party" } = await searchParams;
  const view = by === "region" ? "region_stats" : "party_stats";

  const [{ data: rows }, { data: offices }, { data: recRows }] = await Promise.all([
    db.from(view).select("*").eq("office", office),
    db.from("member_region").select("office").eq("is_incumbent", true),
    db.from("group_record_stats").select("*").eq("office", office).eq("by", by === "region" ? "region" : "party"),
  ]);
  const records = ((recRows ?? []) as GroupRecord[])
    .filter((r) => r.members > 0)
    .sort((a, b) => b.members - a.members);

  const list = ((rows ?? []) as GroupStats[])
    .filter((r) => r.members > 0)
    .sort((a, b) => b.members - a.members);
  const officeList = [...new Set((offices ?? []).map((o) => o.office).filter(Boolean))].sort();
  const hasBills = list.some((r) => r.rep_count > 0);
  const max = Math.max(1, ...list.map((r) => (hasBills ? r.rep_count / r.members : r.pledge_count / r.members)));

  return (
    <div className="space-y-5">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header>
        <h1 className="text-xl font-bold">정당·지역별 통계</h1>
        <p className="mt-1 text-sm text-muted">
          현직만 집계합니다. 인원이 다르므로 합계가 아니라 <b>1인당 평균</b>으로 비교하세요.
        </p>
      </header>

      <form className="flex flex-wrap gap-2">
        <select
          name="office"
          aria-label="직위"
          defaultValue={office}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm"
        >
          {officeList.map((o) => (
            <option key={o} value={o!}>
              {o}
            </option>
          ))}
        </select>
        <select
          name="by"
          aria-label="묶는 기준"
          defaultValue={by}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="party">정당별</option>
          <option value="region">지역별</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          보기
        </button>
      </form>

      {!list.length ? (
        <p className="rounded-lg border border-line bg-card p-6 text-sm text-muted">
          집계할 데이터가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          {/* 핵심 비교(1인당 값 + 막대)를 이름 바로 옆에 둔다. 예전엔 맨 오른쪽이라 모바일에서
              표를 밀어야 보였고, 밀면 이름이 사라졌다. 이름 열은 붙박이로 둔다. */}
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="sticky left-0 z-10 bg-card px-4 py-2.5 font-medium">{by === "region" ? "지역" : "정당"}</th>
                <th className="w-[28%] px-2 py-2.5 font-medium">
                  {hasBills ? "1인당 대표발의" : "1인당 공약"}
                </th>
                <th className="px-2 py-2.5 text-right font-medium">인원</th>
                {hasBills && (
                  <>
                    <th className="px-2 py-2.5 text-right font-medium">대표발의 합계</th>
                    <th className="px-2 py-2.5 text-right font-medium">가결률</th>
                    <th className="px-2 py-2.5 text-right font-medium">표결참여</th>
                  </>
                )}
                <th className="px-2 py-2.5 text-right font-medium">공약 합계</th>
                {hasBills && <th className="px-4 py-2.5 text-right font-medium">1인당 공약</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const per = hasBills ? r.rep_count / r.members : r.pledge_count / r.members;
                // 한두 명짜리 묶음의 '1인당' 은 그 사람 한 명의 기록이다. 흐리게 두고 아래에 적는다.
                const few = r.members < SMALL_GROUP;
                return (
                  <tr key={r.name} className={`border-b border-line/60 last:border-0 ${few ? "text-muted" : ""}`}>
                    <td className="sticky left-0 z-10 bg-card px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {by === "party" && (
                          <span
                            className="h-3 w-1 shrink-0 rounded-full"
                            style={{ background: partyColor(r.name) }}
                          />
                        )}
                        <span className={few ? "" : "font-medium text-foreground"}>
                          {r.name}{few && <span aria-label="인원 적음">*</span>}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className={`w-10 shrink-0 text-right font-semibold tabular-nums ${few ? "" : "text-foreground"}`}>
                          {per.toFixed(1)}
                        </span>
                        <span className="h-2 flex-1 rounded-full bg-foreground/5">
                          <span
                            className="block h-2 rounded-full"
                            style={{
                              width: `${Math.max(2, (per / max) * 100)}%`,
                              background: by === "party" ? partyColor(r.name) : "var(--viz-1)",
                              opacity: few ? 0.45 : 1,
                            }}
                          />
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{r.members}</td>
                    {hasBills && (
                      <>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {r.rep_count.toLocaleString()}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {pct(r.rep_passed, r.rep_count)}%
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          {pct(r.vote_attended, r.vote_total)}%
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {r.pledge_count.toLocaleString()}
                    </td>
                    {hasBills && (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {(r.pledge_count / r.members).toFixed(1)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {records.length > 0 && <RecordTable rows={records} by={by} office={office} />}

      {(list.some((r) => r.members < SMALL_GROUP) || records.some((r) => r.members < SMALL_GROUP)) && (
        <p className="text-xs text-muted">
          * 인원이 {SMALL_GROUP}명 미만이라 1인당 값이 한두 사람의 기록입니다. 다른 묶음과 견줄 때 주의하세요.
        </p>
      )}
      <p className="text-xs text-muted">
        가결률은 대표발의 기준이며 분모에 계류 중인 법안이 포함됩니다. 표결참여는 (전체 표결 −
        불참) ÷ 전체 표결입니다. 공약은 선거공보와 선거공약서를 합한 수입니다. 공개 기록 표의
        비율은 사람별 비율의 평균이 아니라 묶음 전체 합계끼리 나눈 값이고, 국회 활동 항목(출석·표결·
        국외활동·연구단체·연구용역·겸직)은 제22대 현직 국회의원만 셉니다.{" "}
        <Link href="/rules" className="underline underline-offset-2">
          판정 기준
        </Link>
      </p>
    </div>
  );
}

/** 천원 → '13.0억'. 표 칸이 좁아 억 단위 한 자리로 줄인다. */
const eok = (k: number) => `${(k / 100000).toFixed(1)}억`;

/** 의원 상세의 공개 기록을 묶음별로. 순서는 위 표와 같이 인원 순이다.
 *  단체장·교육감은 국회 활동이 없어 재산만 남는다. */
function RecordTable({ rows, by, office }: { rows: GroupRecord[]; by: string; office: string }) {
  const mp = office === "국회의원";
  const th = "px-2 py-2.5 text-right font-medium";
  const td = "px-2 py-2.5 text-right tabular-nums";
  const none = <span className="text-muted">—</span>;
  const per = (n: number | null, m: number) => (n == null ? none : (n / m).toFixed(1));
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">공개 기록으로 본 {by === "region" ? "지역" : "정당"}</h2>
      <p className="text-sm text-muted">
        {mp
          ? "본회의 출결, 소속 정당 다수와 다른 표, 재산, 겸직, 국외활동, 연구단체, 연구용역을 묶어 봅니다."
          : "가장 최근에 공개된 재산의 중간값입니다. 새로 취임한 사람은 첫 신고가 공개되기 전이라 빠집니다."}{" "}
        <Link href={mp ? "/rules#attendance" : "/rules#asset"} className="underline underline-offset-2">읽는 법</Link>
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className={`w-full border-collapse text-sm ${mp ? "min-w-[52rem]" : ""}`}>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="sticky left-0 z-10 bg-card px-4 py-2.5 font-medium">{by === "region" ? "지역" : "정당"}</th>
              <th className={th}>인원</th>
              {mp && (
                <>
                  <th className={th}>출석률</th>
                  <th className={th}>정당 다수와 다른 표</th>
                </>
              )}
              <th className={th}>순재산 중간값</th>
              {mp && (
                <>
                  <th className={th}>1인당 국외활동</th>
                  <th className={th}>1인당 연구단체</th>
                  <th className={th}>1인당 연구용역</th>
                  <th className={`${th} pr-4`}>겸직 불가·사직 권고</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const few = r.members < SMALL_GROUP;
              return (
                <tr key={r.name} className={`border-b border-line/60 last:border-0 ${few ? "text-muted" : ""}`}>
                  <td className="sticky left-0 z-10 bg-card px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      {by === "party" && (
                        <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: partyColor(r.name) }} />
                      )}
                      <span className={few ? "" : "font-medium text-foreground"}>
                        {r.name}{few && <span aria-label="인원 적음">*</span>}
                      </span>
                    </span>
                  </td>
                  <td className={td}>{r.members}</td>
                  {mp && (
                    <>
                      <td className={td}>{r.days ? `${pct(r.present ?? 0, r.days)}%` : none}</td>
                      <td className={td}>
                        {/* 무소속은 '당의 다수' 가 없어 세지 않는다. */}
                        {r.party_counted ? `${((100 * (r.against_party ?? 0)) / r.party_counted).toFixed(1)}%` : none}
                      </td>
                    </>
                  )}
                  <td className={td}>
                    {r.net_median_k == null ? none : (
                      <>
                        {eok(r.net_median_k)}
                        {r.asset_n < r.members && (
                          <span className="ml-1 text-xs text-muted">({r.asset_n}명)</span>
                        )}
                      </>
                    )}
                  </td>
                  {mp && (
                    <>
                      <td className={td}>{per(r.trips, r.members)}</td>
                      <td className={td}>{per(r.research, r.members)}</td>
                      <td className={td}>{per(r.studies, r.members)}</td>
                      <td className={`${td} pr-4`}>{r.sidejob_flagged ? `${r.sidejob_flagged}명` : "0"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {mp && "출석률 = 출석 ÷ 본회의 회의일수(묶음 합계). 정당 다수와 다른 표는 의원 페이지와 같은 규칙이며 무소속은 세지 않습니다. "}
        순재산은 가장 최근 공개분이고, 괄호는 재산이 공개된 인원입니다.
        {mp && " 국외활동·연구단체·연구용역은 제22대 신고·등록·결과보고서 건수(연구용역은 금액 비공개, 공동 발주는 의원마다 한 건), 겸직은 불가·사직 권고를 한 번이라도 받은 인원입니다."}
      </p>
    </section>
  );
}
