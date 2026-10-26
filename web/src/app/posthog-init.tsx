"use client";

import { useEffect } from "react";

// PostHog(인디 앱 공용 프로젝트). Vercel 환경변수 NEXT_PUBLIC_POSTHOG_KEY 가 있을 때만 — GA4와 같은 규칙.
// App Router 경로 이동은 capture_pageview: 'history_change' 가 잡는다.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export function PostHogInit() {
  useEffect(() => {
    if (!KEY) return;
    import("posthog-js").then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: "https://us.i.posthog.com",
        autocapture: false,
        capture_pageview: "history_change",
        capture_pageleave: false,
        disable_session_recording: true,
      });
      posthog.register({
        app: "nureongso",
        environment: process.env.NODE_ENV === "production" ? "production" : "staging",
      });
    });
  }, []);
  return null;
}
