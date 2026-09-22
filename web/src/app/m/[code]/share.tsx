"use client";

import { useState } from "react";

/** 이 레포의 첫 클라이언트 컴포넌트다. 공유는 서버에서 할 수 없다 —
 *  navigator.share 도 클립보드도 브라우저 API 다.
 *
 *  모바일에서는 OS 공유 시트가 뜨고(카카오톡·메시지 그대로), 데스크톱처럼
 *  share 가 없는 곳에서는 주소를 복사한다. 링크 미리보기는 이미 OG 카드가 맡는다. */
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
      // 사용자가 공유 시트를 닫은 것도 여기로 온다. 실패로 볼 일이 아니다.
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="rounded-md border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-muted hover:text-foreground"
    >
      {done ? "주소 복사됨" : "공유"}
    </button>
  );
}
