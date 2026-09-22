import Link from "next/link";

export const metadata = {
  title: "판정 기준",
  alternates: { canonical: "/rules" },
  description: "공약 이행 여부를 어떤 근거로, 어떤 규칙으로 판정하는지 전부 공개합니다.",
};

export default function RulesPage() {
  return (
    <div className="space-y-6">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header>
        <h1 className="text-xl font-bold">판정 기준</h1>
        <p className="mt-2 text-sm text-muted">
          공약 이행 여부는 어느 기관도 공식으로 발표하지 않습니다. 이 서비스가 공개된
          자료를 모아 내린 판정이며, 아래 규칙을 그대로 적용합니다. 규칙을 공개하는 이유는
          같은 자료로 누구나 같은 결과에 이를 수 있어야 하기 때문입니다.
        </p>
      </header>

      <Box title="1. 공약마다 '무엇으로 확인할 수 있는가'를 먼저 정합니다">
        <p className="text-muted">
          주제(교통·복지)가 아니라 확인 수단으로 나눕니다. 확인할 방법이 없는 공약을
          억지로 판정하지 않기 위해서입니다.
        </p>
        <Table
          head={["유형", "뜻", "확인 수단"]}
          rows={[
            ["법률 제·개정", "법을 만들거나 고쳐야 이뤄진다", "국회 법안 발의와 통과"],
            ["예산·사업", "시설을 짓거나 사업을 벌인다", "예산 편성과 착공 (아직 미구현)"],
            ["조례·제도", "지자체 조례나 행정 제도를 바꾼다", "자치법규 제·개정 (단체장·교육감만)"],
            ["방향 제시", "구체적 대상과 수단이 없다", "확인 불가"],
          ]}
        />
        <p className="text-xs text-muted">
          실제 집계에서 국회의원 공약의 약 10%만 법률로 잴 수 있고, 60%는 지역 사업입니다.
          지금 잴 수 있는 것은 <b>법률</b>과 <b>조례</b> 둘뿐이고, 나머지는{" "}
          <b>측정 수단 없음</b>으로 둡니다. 조례는 단체장·교육감만 해당합니다 —
          국회의원은 조례를 만들 수 없기 때문입니다.
        </p>
      </Box>

      <Box title="2. 판정 규칙">
        <Table
          head={["근거", "판정"]}
          rows={[
            ["본인이 대표발의한 관련 법안이 통과됨", "완료"],
            ["임기 중 관련 조례가 제·개정됨", "완료"],
            ["위가 확인됐으나 못 재는 유형이 남아 있음", "진행"],
            ["관련 법안을 대표발의했으나 계류·폐기", "진행"],
            ["관련 기록이 없고 임기 2년이 지남", "미착수"],
            ["관련 기록이 없고 임기 2년 미만", "판단불가"],
            ["아직 공식 기록과 대조하지 않음", "판단불가"],
            ["잴 수 있는 유형이 하나도 없음", "판단불가 (측정 수단 없음)"],
          ]}
        />
        <p className="text-muted">
          공식 기록을 찾아보지도 않은 공약을 <b>미착수</b>로 적지 않습니다. 대조를 마친
          사람만 판정하고, 나머지는 아직 확인하지 않았다고 표시합니다.
        </p>
        <p className="text-muted">
          한 공약에 여러 수단이 섞여 있고 <b>못 재는 쪽이 남아 있으면 완료로 적지
          않습니다.</b> &lsquo;노인복지법 개정과 복지관 건립&rsquo; 에서 법이 통과됐다고
          복지관이 지어진 것은 아니기 때문입니다. 이런 공약은 <b>진행</b>까지만 갑니다.
        </p>
        <p className="text-muted">
          <b>공동발의는 근거로 쓰지 않습니다.</b> 다른 의원이 낸 법안에 이름을 올린 것이라
          본인이 공약을 이행했다는 증거로는 약합니다. 공동발의 건수는 따로 표시합니다.
        </p>
      </Box>

      <Box title="3. 공약과 근거는 AI가 연결하고, 원문을 함께 보여줍니다">
        <p className="text-muted">
          공약 문장을 그 의원이 대표발의한 법안 목록, 그리고 그 지자체가 임기 중 제·개정한
          자치법규 목록과 대조해 연결합니다. 연결된 법안·조례는 공약 아래에 링크로 붙어
          있어 직접 확인할 수 있습니다. 맞는 것이 없으면 억지로 붙이지 않습니다.
        </p>
        <p className="text-muted">
          <b>AI 가 &lsquo;이행됐다&rsquo;고 말하지는 않습니다.</b> AI 는 &lsquo;이 공약과
          이 기록이 같은 일인가&rsquo; 만 판단하고, 판정은 위의 규칙표가 합니다. 규칙표는
          사람 판단이 아니라 표를 따르므로 몇 번을 돌려도 같은 결과가 나옵니다.
        </p>
        <p className="text-xs text-muted">
          한계: 이름만으로 판단하므로 이름이 포괄적인 개정안은 놓칠 수 있습니다.
          실제보다 적게 잡히는 쪽을 택했습니다. 없는 근거를 붙이는 것이 더 해롭기 때문입니다.
        </p>
      </Box>

      <Box title="4. 자동 판정과 검수 판정을 구분해 표시합니다">
        <p className="text-muted">
          위 규칙으로 기계가 내린 판정에는 <b>자동</b> 표시가 붙습니다. 사람이 확인해
          확정한 판정은 표시가 없습니다. 자동 판정은 초안이며, 검수로 뒤집힐 수 있습니다.
        </p>
      </Box>

      <Box title="5. 댓글과 평점이 없는 것은 빠뜨린 것이 아닙니다">
        <p className="text-muted">
          정치인에 대한 의견은 이미 넘칩니다. 없는 것은 기록입니다. 이 사이트는 기록만
          두기 위해 댓글·평점·추천을 두지 않습니다. 여기 있는 모든 숫자는 위 규칙과 아래
          출처로 누구나 다시 계산해 확인할 수 있어야 하는데, 이용자 의견은 그럴 수 없습니다.
        </p>
        <p className="text-xs text-muted">
          이용자 평가를 모아 공개하지도 않습니다. 그것은 공직선거법이 선거일 전 공표를
          제한하는 여론조사에 해당할 소지가 있습니다. 사실과 다른 내용을 발견하셨다면
          아래 출처와 함께 알려주세요. 고치는 것은 저희 몫입니다.
        </p>
      </Box>

      <Box title="출처">
        <ul className="list-disc space-y-1 pl-4 text-muted">
          <li>법안·발의·표결: 국회 열린국회정보 Open API</li>
          <li>당선인·득표·대표공약: 중앙선거관리위원회 공공데이터</li>
          <li>공약 원문: 중앙선거관리위원회 정책·공약마당 선거공보</li>
          <li>조례·규칙: 법제처 국가법령정보 자치법규 Open API</li>
        </ul>
        <p className="text-xs text-muted">
          모든 수치는 수집 시점 기준입니다. 사실과 다른 내용을 발견하시면 알려주세요.
        </p>
      </Box>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-line/60 last:border-0">
              {r.map((c, i) => (
                <td key={i} className={`py-1.5 pr-3 ${i === 0 ? "font-medium" : "text-muted"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
