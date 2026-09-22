"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "nrs.compare";
const BTN =
  "rounded-md border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-muted hover:text-foreground";

type Picked = { code: string; name: string };

function read(): Picked[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.slice(0, 2) : [];
  } catch {
    return []; // 사생활 보호 모드나 저장소 차단. 비어 있는 것으로 본다.
  }
}

/** 비교함. 드롭다운에서 558명 중 찾는 대신 상세 페이지를 돌며 한 명씩 담는다.
 *
 *  비교표가 두 칸이라 두 명까지만 담는다. 꽉 찬 상태에서 또 담으면 먼저 담은
 *  사람이 빠진다 — '가득 찼습니다' 로 막으면 어디를 지워야 하는지 알려줘야 하고,
 *  그 화면을 또 만들어야 한다.
 *
 *  localStorage 를 쓴다. 서버에 담아두려면 계정이 필요하고, 이 서비스는 계정을
 *  만들지 않는다. 기기 사이로 안 넘어가지만 비교는 한자리에서 끝나는 일이다. */
export function CompareButton({ code, name }: Picked) {
  const [list, setList] = useState<Picked[] | null>(null); // null = 아직 안 읽음
  useEffect(() => setList(read()), []);

  // 서버 렌더와 첫 그리기를 맞춘다. 저장소를 읽기 전에 '빼기' 를 보이면 깜빡인다.
  if (!list) return <span className={`${BTN} invisible`}>비교에 추가</span>;

  const has = list.some((x) => x.code === code);
  const save = (next: Picked[]) => {
    setList(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // 저장이 막혀도 이 화면 안에서는 동작한다.
    }
  };

  const other = list.find((x) => x.code !== code);
  return (
    <>
      <button
        type="button"
        className={BTN}
        onClick={() =>
          save(has ? list.filter((x) => x.code !== code) : [...list, { code, name }].slice(-2))
        }
      >
        {has ? "비교함에서 빼기" : "비교함에 담기"}
      </button>
      {has && other && (
        <Link href={`/compare?a=${other.code}&b=${code}`} className={BTN}>
          {other.name} 와 비교 →
        </Link>
      )}
      {has && !other && <span className={`${BTN} border-dashed`}>담김 · 한 명 더</span>}
    </>
  );
}

/** 공유. 서버에서 할 수 없다 — navigator.share 도 클립보드도 브라우저 API 다.
 *  모바일은 OS 공유 시트가 뜨고, 없는 곳은 주소를 복사한다. */
export function ShareButton({ title }: { title: string }) {
  const [done, setDone] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // 공유 시트를 닫은 것도 여기로 온다. 실패로 볼 일이 아니다.
    }
  }

  return (
    <button type="button" onClick={share} className={BTN}>
      {done ? "주소 복사됨" : "공유"}
    </button>
  );
}
