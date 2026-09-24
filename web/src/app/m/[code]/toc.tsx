"use client";

import { useEffect, useRef, useState } from "react";

/** 의원 페이지의 목차. 링크 자체는 앵커라 스크립트 없이도 동작하고, 스크립트는
 *  '지금 읽는 구획' 을 강조하는 일만 한다 — 한 사람 화면이 길어서(공약 수십 건, 법안 수백 건)
 *  내려가다 보면 어디쯤인지 잃는다. 강조된 칸이 가로 목록 밖이면 보이게 굴린다. */
export function TocNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const els = items
      .map((n) => document.getElementById(n.id))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const pick = () => {
      // 목차(약 56px) 바로 아래 선을 지난 구획 중 마지막 것이 지금 구획이다.
      const line = 72;
      let cur: string | null = null;
      for (const e of els) if (e.getBoundingClientRect().top - line <= 0) cur = e.id;
      setActive(cur);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [items]);

  useEffect(() => {
    if (!active || !list.current) return;
    const a = list.current.querySelector<HTMLElement>(`[data-id="${CSS.escape(active)}"]`);
    if (!a) return;
    const box = list.current;
    const left = a.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + a.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollTo({ left: left - 16, behavior: "smooth" });
    }
  }, [active]);

  return (
    <ul ref={list} className="flex gap-1.5 overflow-x-auto whitespace-nowrap">
      {items.map((n) => {
        const on = n.id === active;
        return (
          <li key={n.id}>
            <a
              href={`#${n.id}`}
              data-id={n.id}
              aria-current={on ? "location" : undefined}
              className={`block rounded-full border px-3 py-1.5 text-xs transition ${
                on
                  ? "border-foreground bg-foreground font-semibold text-background"
                  : "border-line text-muted hover:border-muted hover:bg-card hover:text-foreground"
              }`}
            >
              {n.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
