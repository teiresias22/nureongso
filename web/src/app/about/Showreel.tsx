"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/** 파일명에 날짜를 넣는다 — 영상을 다시 만들면 이름을 바꿔 캐시를 우회한다. */
const REEL = "/videos/showreel-2026-09";
/** 폰 세로 화면에서는 16:9 대신 4:5 파일을 쓴다. 16:9 를 폰 폭에 맞추면 글자가 읽히지 않는다. */
const PORTRAIT = "(max-width: 767px) and (orientation: portrait)";

function subscribePortrait(cb: () => void) {
  const mq = window.matchMedia(PORTRAIT);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * 15초 소개 영상. 원본은 color_of_days 레포 marketing/showreel/nureongso 에서 렌더했다.
 *
 * - 화면에 35% 이상 보일 때만 소리 없이 재생하고 벗어나면 멈춘다. preload="none" 이라
 *   스크롤해서 보기 전에는 영상을 받지 않는다(포스터 이미지만 받는다).
 * - 사용자가 멈추면 다시 스크롤해 와도 자동으로 틀지 않는다. 동작 줄이기 설정이면 처음부터 틀지 않는다.
 * - 15초 동안 움직이는 콘텐츠라 멈춤 버튼을 둔다(WCAG 2.2.2).
 */
export function Showreel() {
  const portrait = useSyncExternalStore(subscribePortrait, () => window.matchMedia(PORTRAIT).matches, () => false);
  const ar = portrait ? "4x5" : "16x9";
  const ref = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!reduce && !userPaused.current) void v.play().catch(() => {});
        } else if (!v.paused) v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    const sync = () => {
      setPlaying(!v.paused);
      setMuted(v.muted);
    };
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("volumechange", sync);
    return () => {
      io.disconnect();
      v.removeEventListener("play", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("volumechange", sync);
    };
  }, [ar]);

  const togglePlay = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      userPaused.current = false;
      void v.play().catch(() => {});
    } else {
      userPaused.current = true;
      v.pause();
    }
  };
  const toggleSound = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.paused) {
      userPaused.current = false;
      void v.play().catch(() => {});
    }
  };

  return (
    <figure className="space-y-2">
      <div className={`relative overflow-hidden rounded-lg border border-line bg-card ${portrait ? "mx-auto max-w-md" : ""}`}>
        <video
          key={ar}
          ref={ref}
          className={`block h-auto w-full ${portrait ? "aspect-[4/5]" : "aspect-video"}`}
          poster={`${REEL}-${ar}.webp`}
          muted
          loop
          playsInline
          preload="none"
          aria-label="누렁소검은소 15초 소개 영상 — 어느 소가 일을 더 잘하오? 공약을 공식 기록과 대조해 판정하고, 임기 동안 남긴 기록을 나란히 보여준다. 의견은 싣지 않는다."
        >
          <source src={`${REEL}-${ar}.mp4`} type="video/mp4" />
        </video>
        <div className="absolute bottom-2.5 right-2.5 flex gap-2">
          <ReelButton label={playing ? "일시정지" : "재생"} onClick={togglePlay}>
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>
            )}
          </ReelButton>
          <ReelButton label={muted ? "소리 켜기" : "소리 끄기"} onClick={toggleSound} wide>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none" />
              {muted ? <path d="M11 6l4 4M15 6l-4 4" /> : <path d="M10.5 5.5a3.5 3.5 0 010 5M12.5 3.5a6.5 6.5 0 010 9" />}
            </svg>
            <span className="text-xs font-semibold">{muted ? "소리 켜기" : "소리 끄기"}</span>
          </ReelButton>
        </div>
      </div>
      {/* 영상 속 후보·수치는 예시다. 실존 인물로 읽히면 이 서비스의 원칙과 어긋나서 캡션에 못 박는다. */}
      <figcaption className="text-xs leading-5 text-muted">
        15초 소개 영상. 화면 속 후보와 기록 수치는 설명을 위한 예시이며 실제 인물·정당과 관계없습니다.
      </figcaption>
    </figure>
  );
}

function ReelButton({ label, onClick, wide, children }: { label: string; onClick: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-stone-900/80 text-white ring-1 ring-white/40 backdrop-blur transition hover:bg-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${wide ? "px-3" : "w-9"}`}
    >
      {children}
    </button>
  );
}
