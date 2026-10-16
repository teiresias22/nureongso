import NextLink from "next/link";
import type { ComponentProps } from "react";

/** prefetch 를 기본으로 끈 next/link. 사이트 안 링크는 전부 이것을 쓴다(eslint 가 next/link 를 막는다).
 *
 *  JS 를 실행하는 크롤러(OAI-SearchBot)가 법안 페이지를 돌 때마다 머리글 메뉴가 `/`·`/stats`·
 *  `/compare`·`/my` 를 prefetch 했다. `_rsc` 키가 보던 페이지마다 달라 CDN 캐시도 못 타고, `/` 는
 *  558명 목록을 통째로 그려 한 번에 313ms 를 썼다. 2026-10 Vercel Active CPU 무료 4시간이 이걸로 찼다.
 *  누를 때 받아도 늦지 않다. 꼭 미리 받아야 하는 링크만 `prefetch` 를 직접 준다. */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
