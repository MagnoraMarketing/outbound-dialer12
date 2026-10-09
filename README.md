# Nordcall

A Danish-language B2B CRM and outbound calling workspace built with Next.js, Supabase and Telnyx. The application keeps private telephony and database credentials on the server and uses Supabase Row Level Security for data access.

## Run locally

1. Install Node.js 20+ and dependencies with `npm install`.
2. In the shared Supabase project, add `nordcall` to **Project Settings → API → Exposed schemas** (keep existing schemas), then apply `supabase/migrations/20261005000000_initial_schema.sql` for a new setup, followed by newer migrations in timestamp order. Migrations 200–500 add campaigns, assignments, campaign leads, targets and messages; 600 adds budget activities and Cal.com storage; 700 stores per-user Telnyx WebRTC credentials; 800 adds admin reporting and private recording storage. Nordcall tables live in the separate `nordcall` schema. Nordcall signups are marked explicitly so the auth trigger creates `nordcall.profiles` only for Nordcall users.
3. Copy `.env.example` to `.env.local`, and add the project URL, anon key and service-role key. For outbound calls, configure the server-only Telnyx API key, a SIP Credential Connection ID in `TELNYX_WEBRTC_CONNECTION_ID`, and an E.164 caller number in `TELNYX_PHONE_NUMBER`. The Telnyx connection must allow outbound calling and have that number available as caller ID. The browser prompts the seller for microphone permission; production use requires HTTPS.
4. In Supabase Authentication → URL Configuration, add the production app origin, `/admin`, and `/auth/callback` URLs to **Redirect URLs**. Add localhost URLs only for local testing, and preserve the existing Site URL and other app redirects on shared projects. Set `NEXT_PUBLIC_APP_URL` to production and request password resets from the production app. Password recovery uses `/auth/callback` and returns to the login page where it was requested. The first Nordcall user can sign up and create a team; that user becomes the team administrator. Accounts with the administrator role can sign in at both `/` and `/admin`; regular users use `/`.
5. Run `npm run dev` and open `http://localhost:3000`.

`npm run lint` runs ESLint, `npm run typecheck` checks TypeScript and `npm run build` creates a production build. The API returns a clear configuration error if Supabase has not been configured. Do not put a Supabase service-role key or Telnyx API key in a `NEXT_PUBLIC_` variable.

## Included

- Supabase email/password authentication, user profiles, teams, role-aware policies and server-side session refresh.
- Lead list/search, lead creation, assignment, status updates and server-validated CSV import with duplicate detection.
- Admin-managed campaigns and campaign-specific lead lists; admins can assign each to individual team members and import leads directly to a selected member.
- Manually created leads require a campaign and may optionally be added to one of its lead lists. Admins can create a list while adding a lead.
- The Opkald workspace filters its queue to the selected campaign and optional lead list, supports manual dialing without a lead, and can create a confirmed lead in that campaign/list.
- Weekly and monthly booked-meeting targets per seller, with optional campaign targets, individual progress on the dashboard and team progress/editing for admins.
- Persistent in-app admin messages to the whole team, a campaign, or a lead list; unread items appear in the notification bell. Browser push is not used.
- Manual Telnyx calls are stored in call history without creating placeholder leads.
- Telnyx WebRTC calls connect the seller's browser headset directly; per-user credentials and JWTs are issued server-side so the Telnyx API key stays private. Calls can be recorded only when an admin enables recording for that user's profile; recordings are stored privately and playback is admin-only.
- Queue, callbacks, meetings and daily dashboard API surfaces.
- Partners (samarbejdspartnere): admins create partners, attach campaigns and create partner logins. Partner users sign in at `/kunde`, see meetings booked on their partner's campaigns in a calendar and list, and rate each held meeting as *Godt møde*, *Mindre godt møde* or *Ikke kvalificeret* with a note. A meeting without a status 12 hours after it started shows as overdue: the partner sees a reminder in the portal, the seller sees the status and note on the meeting with a "Ny" marker and a badge on Møder, and admins follow overdue meetings and all feedback under **Mødefeedback**. Partner logins have no team profile and only reach their own data through server routes.
- Meeting links on bookings can only be set by administrators.
- **Magnora Empire** (Spil): a business-tycoon game for team members with virtual kroner, levels, an isometric city, missions and Magnora Market, which unlocks at 100.000 DKK of administrator-approved sales earnings (**Godkend indtjening**). See [docs/magnora-empire.md](docs/magnora-empire.md).
- **Telefonnumre** (admin): numbers are fetched from the telephony account (`GET /v2/phone_numbers` with `TELNYX_API_KEY`) or added manually, assigned per campaign, and one is marked as the team default. The server picks the caller number for each call (campaign number → team default → `TELNYX_PHONE_NUMBER` as a legacy fallback) and stores it on the call; sellers never choose it. Apply `20261010110000_campaign_phone_numbers.sql`.
- Sellers' settings show only what is relevant to them (profile, password change, recording status, microphone check); telephony and auth details are admin-only.
- SQL migration with indexes, audit events and Row Level Security policies.

## Deployment and compliance

### Deploy to Vercel

The repository is configured for Next.js on Vercel in `vercel.json`. To deploy from GitHub, sign in to Vercel, choose **Add New → Project**, import `MagnoraMarketing/outbound-dialer12`, and deploy. Vercel will build each push to the production branch and create preview deployments for other branches.

Alternatively, from the repository root run `npx vercel login`, then `npx vercel link` to link the local checkout to your Vercel project. Run `npx vercel` for a preview deployment and `npx vercel --prod` for production.

In Vercel, add the variables from `.env.example` under **Project → Settings → Environment Variables**. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required. Admin invitations, call records and private recordings, user/list assignments, CSV lead imports, and Telnyx WebRTC credential storage require the server-only `SUPABASE_SERVICE_ROLE_KEY`. For browser calling, also set `TELNYX_API_KEY`, `TELNYX_WEBRTC_CONNECTION_ID`, and `TELNYX_PHONE_NUMBER`; the Telnyx connection must permit outbound calls and the number must be an authorized caller ID. Set `NEXT_PUBLIC_APP_URL` to the final public HTTPS URL (for example `https://app.example.dk`). Redeploy after changing environment variables.

To use a custom domain, open **Project → Settings → Domains** in Vercel, add your domain, and follow the DNS records Vercel displays at your DNS provider. After Vercel verifies it, set `NEXT_PUBLIC_APP_URL` to that domain and redeploy. In the shared Supabase project's Authentication → URL Configuration, preserve the existing **Site URL** and redirect entries; add the exact Nordcall app URL, `https://outbound-dialer12.vercel.app` (or `https://app.example.dk` for a custom domain), and callback URL, `https://outbound-dialer12.vercel.app/auth/callback` (or `https://app.example.dk/auth/callback`), to **Redirect URLs**. Also add `http://localhost:3000` and `http://localhost:3000/auth/callback` only if local development is needed. This allows Nordcall confirmation and password-reset links without changing the default redirect used by other apps. Configure the Telnyx connection webhook as `https://app.example.dk/api/calls/webhook`, and set its Ed25519 webhook public key in `TELNYX_PUBLIC_KEY`.

Telephony, recording, contact use, retention and consent requirements depend on your use case and jurisdiction. Configure these with qualified counsel before production use. Recording is disabled by default and can be enabled per user by an admin. Before enabling it, disclose recording to participants and determine lawful basis, retention and deletion procedures. The dialer never automatically initiates calls; power dialing must not be used to bypass legal restrictions. Add team memberships through an administrator-controlled provisioning flow before onboarding multiple users.

Apply migration `20261005080000_admin_insights_and_recordings.sql` before deploying admin statistics and private call recording. Apply `20261010100000_magnora_empire_game.sql` before deploying the game; it needs `SUPABASE_SERVICE_ROLE_KEY` on the server. Apply `20261009090000_partners_and_meeting_feedback.sql` before deploying the partner portal, and add the production `/kunde` URL to Supabase Redirect URLs so partner password resets return to the portal. Allow the production origin, `/admin`, and `/auth/callback` in Supabase Redirect URLs; keep the project's existing Site URL on shared Supabase projects. Keep localhost redirects only for local development. `NEXT_PUBLIC_APP_URL` must match the production origin so password recovery from `/` and `/admin` returns to the correct site. If Supabase redirects a recovery email to localhost, check that the production callback URL is allow-listed and that the reset was requested from the production app.
