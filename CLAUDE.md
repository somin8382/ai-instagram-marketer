# CLAUDE.md

## Operational lessons

### Deploy checklist: environment variables
Before deploying new server-side features, verify that every key in `.env.local`
also exists in Vercel's Environment Variables with the correct value —
especially `SUPABASE_SERVICE_ROLE_KEY` and any other server-only secrets.

- Symptom of a mismatch: works on localhost but fails only in production.
- This deploy's outage (2026-07) was caused by an invalid
  `SUPABASE_SERVICE_ROLE_KEY` in Vercel: every service-role route
  (`/api/ai` credit consume, `/api/subscriptions/start`,
  `/api/applications/submit`, `/api/generated-posts/save`) returned
  errors while localhost worked, because `.env.local` had the correct key
  and Vercel had a stale one. Fix: update the env var in Vercel → redeploy
  (env changes only apply to new deployments).
