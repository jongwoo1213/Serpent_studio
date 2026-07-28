# SERPENT Studio

Serpent 2 입력문을 카드·폼·원문과 2D 형상 미리보기로 편집하는 브라우저 도구입니다.

## 배포용 단일 HTML 만들기 (다른 사람에게 전달할 때)

```bash
npm run build:standalone
```

`release/serpent-studio.html` 파일 하나가 만들어집니다.

- **더블클릭하면 브라우저에서 바로 열립니다.** 설치도, 터미널도, Node.js도 필요 없습니다.
- **인터넷이 전혀 필요 없습니다.** CSS·JS·폰트가 모두 파일 안에 들어 있어 폐쇄망 PC 에서도
  동작합니다. 외부로 나가는 요청이 하나도 없습니다.
- **입력 파일이 어디로도 전송되지 않습니다.** 파싱·형상 계산·검증이 전부 브라우저 안에서
  이뤄지므로, 민감한 입력문을 다룰 때도 안전합니다.
- 이메일 첨부, USB, 공유 폴더 어디에 두어도 그대로 동작합니다.

전달받는 분에게는 "이 파일을 더블클릭하세요"만 안내하면 됩니다. 크롬·엣지·사파리·파이어폭스
모두 지원합니다.

버전을 올릴 때는 다시 빌드해서 새 파일을 배포하면 됩니다.

> 카드 안내의 "공식 문법 보기" 링크만 외부 사이트(serpent.vtt.fi)로 연결되므로, 폐쇄망에서는
> 그 링크만 열리지 않습니다. 나머지 기능은 모두 정상 동작합니다.

## 개발

- Node.js `>=22.13.0`

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
