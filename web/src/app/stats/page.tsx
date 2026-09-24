import Link from "next/link";
import { db, partyColor, pct, type GroupStats } from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "정당·지역별 통계",
  alternates: { canonical: "/stats" },
  description: "정당과 지역에 따라 의정활동이 어떻게 다른지 비교합니다.",
};

type SP = { office?: string; by?: string };

/** 이보다 작은 묶음은 1인당 값이 사실상 한 사람 기록이라 흐리게 두고 주석을 단다. */
const SMALL_GROUP = 3;

export default async function StatsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { office = "국회의원", by = "party" } = await searchParams;
  const view = by === "region" ? "region_stats" : "party_stats";

  const [{ data: rows }, { data: offices }] = await Promise.all([
    db.from(view).select("*").eq("office", office),
    db.from("member_region").select("office").eq("is_incumbent", true),
  ]);

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

      {list.some((r) => r.members < SMALL_GROUP) && (
        <p className="text-xs text-muted">
          * 인원이 {SMALL_GROUP}명 미만이라 1인당 값이 한두 사람의 기록입니다. 다른 묶음과 견줄 때 주의하세요.
        </p>
      )}
      <p className="text-xs text-muted">
        가결률은 대표발의 기준이며 분모에 계류 중인 법안이 포함됩니다. 표결참여는 (전체 표결 −
        불참) ÷ 전체 표결입니다. 공약은 선거공보와 선거공약서를 합한 수입니다.{" "}
        <Link href="/rules" className="underline underline-offset-2">
          판정 기준
        </Link>
      </p>
    </div>
  );
}
