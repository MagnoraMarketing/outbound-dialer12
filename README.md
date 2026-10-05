# Nordcall

A Danish-language B2B CRM and outbound calling workspace built with Next.js, Supabase and Telnyx. The application keeps private telephony and database credentials on the server and uses Supabase Row Level Security for data access.

## Run locally

1. Install Node.js 20+ and dependencies with `npm install`.
2. In the existing Supabase project, add `nordcall` to **Project Settings → API → Exposed schemas** (keep `public` and `storage`), then apply `supabase/migrations/20261005000000_initial_schema.sql` in its SQL editor (or with the Supabase CLI). This migration keeps Nordcall's tables in the separate `nordcall` schema and does not alter existing `public` tables.
3. Copy `.env.example` to `.env.local`, and add the project URL and anon key. Configure Telnyx server-side variables before enabling outbound calls.
4. In Supabase Authentication, configure the local site URL (`http://localhost:3000`) and enable email/password sign-in. The first user can sign up and create a team in the app; that user becomes the team administrator.
5. Run `npm run dev` and open `http://localhost:3000`.

`npm run lint` runs ESLint, `npm run typecheck` checks TypeScript and `npm run build` creates a production build. The API returns a clear configuration error if Supabase has not been configured. Do not put a Supabase service-role key or Telnyx API key in a `NEXT_PUBLIC_` variable.

## Included

- Supabase email/password authentication, user profiles, teams, role-aware policies and server-side session refresh.
- Lead list/search, lead creation, assignment, status updates and server-validated CSV import with duplicate detection.
- Server-only Telnyx outbound call and hang-up requests, signed webhook verification, call records and outcomes.
- Queue, callbacks, meetings and daily dashboard API surfaces.
- SQL migration with indexes, audit events and Row Level Security policies.

## Deployment and compliance

### Deploy to Vercel

The repository is configured for Next.js on Vercel in `vercel.json`. To deploy from GitHub, sign in to Vercel, choose **Add New → Project**, import `MagnoraMarketing/outbound-dialer12`, and deploy. Vercel will build each push to the production branch and create preview deployments for other branches.

Alternatively, from the repository root run `npx vercel login`, then `npx vercel link` to link the local checkout to your Vercel project. Run `npx vercel` for a preview deployment and `npx vercel --prod` for production.

In Vercel, add the variables from `.env.example` under **Project → Settings → Environment Variables**. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required; add server-side Supabase and Telnyx variables only when those features are configured. Set `NEXT_PUBLIC_APP_URL` to the final public HTTPS URL (for example `https://app.example.dk`). Redeploy after changing environment variables.

To use a custom domain, open **Project → Settings → Domains** in Vercel, add your domain, and follow the DNS records Vercel displays at your DNS provider. After Vercel verifies it, set `NEXT_PUBLIC_APP_URL` to that domain and redeploy. In Supabase Authentication, set **Site URL** to the same HTTPS domain and add both `https://app.example.dk/**` and the project's `https://<project>.vercel.app/**` under **Redirect URLs** (keep `http://localhost:3000/**` for local development). Configure the Telnyx connection webhook as `https://app.example.dk/api/calls/webhook`, and set its Ed25519 webhook public key in `TELNYX_PUBLIC_KEY`.

Telephony, recording, contact use, retention and consent requirements depend on your use case and jurisdiction. Configure these with qualified counsel before production use. Recording is not enabled by this application. The dialer never automatically initiates calls; power dialing must not be used to bypass legal restrictions. Add team memberships through an administrator-controlled provisioning flow before onboarding multiple users.
