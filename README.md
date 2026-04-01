## Supabase 인증 메일 브랜딩

Supabase 대시보드에서 인증 메일 제목과 본문을 아래처럼 설정하면
사용자가 메일을 더 쉽게 인식할 수 있습니다.

설정 위치:
- 인증
- 이메일 템플릿
- 회원가입 확인 메일

권장 제목:

```text
AI 인스타그램 마케터 회원가입 인증 메일
```

권장 본문:

```html
<h2>AI 인스타그램 마케터 회원가입 인증</h2>
<p>안녕하세요. AI 인스타그램 마케터입니다.</p>
<p>회원가입을 완료하려면 아래 버튼을 눌러 이메일 인증을 진행해주세요.</p>
<p>이 링크는 회원가입 확인을 위한 용도입니다.</p>
<p><a href="{{ .ConfirmationURL }}">이메일 인증 완료하기</a></p>
<p>본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.</p>
```

주의:
- `{{ .ConfirmationURL }}` 값은 그대로 유지해야 합니다.
- 링크 변수만 유지하면 인증 흐름은 그대로 동작합니다.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
