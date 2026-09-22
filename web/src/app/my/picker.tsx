"use client";

import { useState } from "react";

/** 시도를 고르는 순간 시군구가 채워져야 해서 여기만 클라이언트다.
 *  목록은 서버에서 통째로 넘긴다 — 17개 시도에 시군구 229개라 가볍다. */
export function AreaPicker({
  byRegion,
  sd: sd0,
  wiw: wiw0,
}: {
  byRegion: Record<string, string[]>;
  sd: string;
  wiw: string;
}) {
  const [sd, setSd] = useState(sd0);
  const [wiw, setWiw] = useState(wiw0);
  const wiws = byRegion[sd] ?? [];

  return (
    <form className="flex flex-wrap items-center gap-2">
      <select
        name="sd"
        value={sd}
        // 시도를 바꾸면 앞 시군구는 버린다. 그 시도에 없는 이름이라 결과가 0명이 된다.
        onChange={(e) => {
          setSd(e.target.value);
          setWiw("");
        }}
        className="min-w-40 rounded-md border border-line bg-card px-3 py-2 text-sm"
      >
        <option value="">시·도 선택</option>
        {Object.keys(byRegion).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        name="wiw"
        value={wiw}
        onChange={(e) => setWiw(e.target.value)}
        disabled={!sd}
        className="min-w-40 rounded-md border border-line bg-card px-3 py-2 text-sm disabled:opacity-50"
      >
        <option value="">{sd ? `${sd} 전체` : "시·군·구 선택"}</option>
        {wiws.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
      <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
        찾기
      </button>
    </form>
  );
}
