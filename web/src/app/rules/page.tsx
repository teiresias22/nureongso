import Link from "next/link";

export const metadata = {
  title: "판정 기준 — 누렁소검은소",
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
            ["조례·제도", "지자체 조례나 행정 제도를 바꾼다", "조례 제정 (아직 미구현)"],
            ["방향 제시", "구체적 대상과 수단이 없다", "확인 불가"],
          ]}
        />
        <p className="text-xs text-muted">
          실제 집계에서 국회의원 공약의 약 10%만 법률로 잴 수 있고, 60%는 지역 사업입니다.
          현재 판정할 수 있는 것은 법률 유형뿐이며 나머지는 <b>측정 수단 없음</b>으로 둡니다.
        </p>
      </Box>

      <Box title="2. 법률 유형의 판정 규칙">
        <Table
          head={["근거", "판정"]}
          rows={[
            ["본인이 대표발의한 관련 법안이 통과됨", "완료"],
            ["관련 법안을 대표발의했으나 계류·폐기", "진행"],
            ["관련 법안이 없고 임기 2년이 지남", "미착수"],
            ["관련 법안이 없고 임기 2년 미만", "판단불가"],
            ["법률 유형이 아님", "판단불가 (측정 수단 없음)"],
          ]}
        />
        <p className="text-muted">
          <b>공동발의는 근거로 쓰지 않습니다.</b> 다른 의원이 낸 법안에 이름을 올린 것이라
          본인이 공약을 이행했다는 증거로는 약합니다. 공동발의 건수는 따로 표시합니다.
        </p>
      </Box>

      <Box title="3. 공약과 법안은 AI가 연결하고, 근거를 함께 보여줍니다">
        <p className="text-muted">
          공약 문장과 그 의원이 대표발의한 법안 목록을 대조해 연결합니다. 연결된 법안은
          공약 아래에 링크로 붙어 있어 직접 확인할 수 있습니다. 맞는 법안이 없으면 억지로
          붙이지 않습니다.
        </p>
        <p className="text-xs text-muted">
          한계: 법안 이름만으로 판단하므로 이름이 포괄적인 개정안은 놓칠 수 있습니다.
          실제보다 적게 잡히는 쪽을 택했습니다. 없는 근거를 붙이는 것이 더 해롭기 때문입니다.
        </p>
      </Box>

      <Box title="4. 자동 판정과 검수 판정을 구분해 표시합니다">
        <p className="text-muted">
          위 규칙으로 기계가 내린 판정에는 <b>자동</b> 표시가 붙습니다. 사람이 확인해
          확정한 판정은 표시가 없습니다. 자동 판정은 초안이며, 검수로 뒤집힐 수 있습니다.
        </p>
      </Box>

      <Box title="출처">
        <ul className="list-disc space-y-1 pl-4 text-muted">
          <li>법안·발의·표결: 국회 열린국회정보 Open API</li>
          <li>당선인·득표·대표공약: 중앙선거관리위원회 공공데이터</li>
          <li>공약 원문: 중앙선거관리위원회 정책·공약마당 선거공보</li>
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
