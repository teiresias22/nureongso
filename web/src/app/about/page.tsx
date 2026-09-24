import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "프로젝트 소개",
  alternates: { canonical: "/about" },
  description:
    "어느 소가 일을 잘하는지는 귓속말로 묻습니다. 선출직이 지난 임기에 무엇을 하겠다 했고 무엇을 했는지, 조용히 확인하는 곳입니다.",
};

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header className="flex items-center gap-4">
        {/* 헤더의 32px 로고와 같은 그림. 여기서는 이름의 유래를 설명하는 자리라
            글자보다 그림이 먼저 눈에 들어와야 한다. */}
        <Image
          src="/logo.png"
          alt="누렁소와 검은소"
          width={72}
          height={72}
          className="rounded-lg"
          priority
        />
        <div>
          <h1 className="text-xl font-bold">누렁소검은소</h1>
          <p className="mt-1 text-sm text-muted">선출직이 실제로 한 일</p>
        </div>
      </header>

      <Section title="이름의 유래 — 귓속말로 묻는 이유">
        <p>
          길을 가던 선비가 누렁소와 검은소로 밭을 가는 농부를 보고 물었습니다.
          &ldquo;어느 소가 일을 더 잘하오?&rdquo; 농부는 대답하지 않고 하던 일을 멈추더니,
          선비에게 걸어와 귀에 대고 조그맣게 말했습니다. 왜 굳이 다가와 속삭이느냐 묻자
          농부가 답했습니다. &ldquo;아무리 짐승이라도 저를 못한다 하면 기분이 상하지
          않겠소.&rdquo;
        </p>
        <p>
          이 서비스의 이름은 여기서 왔습니다. <b>물음은 필요합니다.</b> 누가 일을 잘하고
          누가 못했는지 알아야 다음에 누구에게 맡길지 정할 수 있으니까요. 다만 그 물음을
          모두가 듣는 자리에서 큰 소리로 할 필요는 없습니다.
        </p>
        <p>
          그래서 이곳에는 <b>댓글도, 평점도, 추천 버튼도 없습니다.</b> 누가 잘했다 못했다
          떠드는 자리를 하나 더 만들려는 것이 아닙니다. 그런 자리는 이미 넘칩니다. 여기
          있는 것은 기록뿐이고, 판단은 화면 앞에 혼자 앉은 당신 몫입니다. 조용히 보고,
          조용히 결정하시면 됩니다.
        </p>
      </Section>

      <Section title="왜 만들었나 ① — 공약은 늘 앞만 이야기합니다">
        <p>
          선거 때 받아 드는 공보에는 앞으로 하겠다는 일만 빼곡합니다. 정작 지난 임기에
          무엇을 하겠다고 했었는지, 그중 무엇이 이뤄졌는지는 어디에도 적혀 있지 않습니다.
          적을 의무도 없습니다.
        </p>
        <p>
          그래서 4년 전의 약속은 조용히 잊힙니다. 잊히는 편이 유리한 쪽은 약속을 한
          사람이고, 손해를 보는 쪽은 그 약속을 믿고 표를 준 사람입니다. 다음 선거는 다시
          앞으로의 약속만으로 치러집니다.
        </p>
        <p>
          <b>이 서비스는 그 잊힌 절반을 꺼내 옆에 둡니다.</b> 지난 임기에 무엇을 약속했고,
          공식 기록에 무엇이 남았는지를 같은 화면에 놓습니다. 그러면 새 약속을 어느 정도로
          믿을지 스스로 가늠할 수 있습니다.
        </p>
      </Section>

      <Section title="왜 만들었나 ② — 한 지역의 공약은 다 비슷합니다">
        <p>
          같은 지역에 나온 후보들의 공약을 나란히 놓고 보면 놀랄 만큼 닮아 있습니다. 역을
          유치하고, 도로를 넓히고, 학교를 짓고, 복지를 확대하겠다고 합니다. 문장만 읽어서는
          누가 무엇을 다르게 하겠다는 것인지 가려내기가 어렵습니다.
        </p>
        <p>
          그렇다면 가를 수 있는 것은 <b>말이 아니라 기록</b>뿐입니다. 같은 약속을 한
          사람들 중 누가 실제로 법안을 냈고, 누가 조례를 만들었고, 누가 본회의에
          나왔는지는 서로 다릅니다. 그 차이는 공보에 실리지 않지만 공공기관이 이미 전부
          기록해 두고 있습니다. 흩어져 있어서 아무도 안 볼 뿐입니다.
        </p>
        <p>
          그 흩어진 기록을 한 사람 아래로 모아, 옆 사람과 나란히 놓고 볼 수 있게 하는 것이
          이 서비스가 하는 일의 전부입니다.
        </p>
      </Section>

      <Section title="지키는 것">
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            <b>공식 기록만 씁니다.</b> 국회·선거관리위원회·법제처가 공개한 자료만 쓰고,
            언론 보도나 본인 홍보는 근거로 삼지 않습니다.
          </li>
          <li>
            <b>모르는 것은 모른다고 적습니다.</b> 확인할 수단이 없는 공약은 억지로 판정하지
            않고 &lsquo;측정 수단 없음&rsquo;으로 둡니다. 기록이 없는 것을 0으로 적으면
            거짓이 됩니다.
          </li>
          <li>
            <b>판정 규칙을 전부 공개합니다.</b> 같은 자료로 누구나 같은 결과에 이를 수
            있어야 합니다. 규칙은{" "}
            <Link href="/rules" className="underline underline-offset-2">
              판정 기준
            </Link>
            에 있습니다.
          </li>
          <li>
            <b>숫자가 크다고 잘한 것은 아닙니다.</b> 발의가 많은 것이 좋은 의정이라는 뜻은
            아닙니다. 이 서비스는 순위를 매기지 않고, 숫자를 보여줄 뿐입니다.
          </li>
        </ul>
      </Section>

      <p className="text-xs text-muted">
        사실과 다른 내용을 발견하시면 출처와 함께 알려주세요. 고치는 것은 저희 몫입니다.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {/* 이 페이지의 본문이라 흐린 글자로 두지 않는다. 한 줄 65자 안팎으로 자른다. */}
      <div className="mt-3 space-y-3 text-[15px] leading-7 [&_p]:max-w-prose">{children}</div>
    </section>
  );
}
