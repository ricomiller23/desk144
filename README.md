# Desk 144

Daily SEC Form 144 sweep → ranked OTC block-purchase targets.
Pulls the EDGAR daily index, parses structured Form 144 XML, filters to OTC
issuers, and scores each seller by OTC gate + acquisition basis (debt/convert/
PIPE) + sell-to-outstanding slice + capped size. Next.js (Node runtime), no DB.

## Deploy

### Option A — Vercel CLI (fastest)
    npm i -g vercel
    cd desk144
    vercel deploy --prod        # prompts login + links/creates the project

### Option B — Git integration
Push this folder to a GitHub/GitLab repo, then "Add New Project" in the Vercel
dashboard and import it. Pushes auto-deploy.

## Required setting
In Vercel → Project → Settings → Environment Variables, add:

    SEC_USER_AGENT = YourFirm - Your Name - you@email.com

SEC fair-access blocks requests without a descriptive User-Agent.

## Notes
- `app/api/pull/route.ts` has `maxDuration = 60`. Hobby plan caps at 60s; on a
  heavy filing day raise it on Pro, or lower "Max filings" in the UI.
- Non-reporting dark pinks don't file Form 144 on EDGAR and won't appear.
- Local dev: `npm install && npm run dev` → http://localhost:3000
