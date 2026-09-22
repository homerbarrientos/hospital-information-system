# Hospital ONE

Infirmary Core MVP foundation covering patient registration, consultation, admission and transfer, orders and results, pharmacy and inventory, billing and cashiering, administration, audit, and essential management reporting.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. With no Supabase credentials, the application displays clearly marked synthetic data for workflow review.

## Connect Supabase

Create a dedicated development project, fill `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then apply `supabase/migrations/202609140001_phase1_foundation.sql` through the Supabase CLI. Configure `SUPABASE_SERVICE_ROLE_KEY` only in the server deployment environment when staff invitation emails are enabled; never expose it to browser code.

## Safety status

This build is for development and workflow validation. It is not approved for live patient information, clinical use, PhilHealth submission, or production deployment. See `docs/IMPLEMENTATION_PLAN.md` for the next implementation slices.

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
