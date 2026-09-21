# Conseiv Parametric Studio

Implemented as a local canary on 2026-09-07. Not deployed to conseiv.com.

This is a real mounting-bracket workbench grounded in the existing
`mvp/bracket-generator.js`, not a claim that general-purpose AGI CAD exists.
The older root `index.html`, `mvp/`, and other deployment directories were not
replaced. The new build is isolated in `dist/`; it does not include the old site.

## What works locally

- React/Tailwind studio using the Conseiv cyan/dark tokens from
  `skeletonking/design-tokens/conseiv.com.css`, with self-hosted fonts.
- Three.js orbit/zoom viewer, formed and flat-pattern views, wireframe and fit.
  Renders on changes rather than running an idle animation loop.
- Real parametric geometry with through holes, bend radius, angle and K-factor.
  Bounded numeric inputs, non-overlapping holes and explicit geometry errors.
- Worker `POST /api/conseiv/cad-mesh-generation`, OBJ/STL mesh export.
- D1 users, hashed sessions and owner-scoped assets. Assets retain both their
  parameters and generated geometry so later algorithms do not rewrite history.
- AuthFor register/login/verify adapter using the actual existing public API.
  No independent password database and no fabricated service binding.
- Library list/open/save/delete API and interface, with a confirm step before
  a delete request is sent.
- D1-backed rate limiting on `/api/auth/register` and `/api/auth/login`, keyed
  by both requester IP and the submitted email (10 attempts per 15 minutes per
  key), rejecting further attempts with 429 before calling AuthFor at all.

See `shared/API_CONTRACT.md` for exact payloads, limits and authentication.

## Reproduce

Node >=22.12; tested here with Node 26.3.0. Use the repository's locked packages.

```sh
npm ci
npm test
npm run db:local
npm run preview
```

Visit `http://127.0.0.1:8796`. Local migrations do not touch Cloudflare D1.
`npm run dev` runs the Vite frontend and proxies API calls to that Worker.

Browser checks use an isolated Chromium process, not your signed-in browser:

```sh
npx playwright install chromium
npm run test:browser
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible
Chromium executable to avoid downloading another browser. Screenshots are in
ignored `test-results/`. Tests cover desktop and mobile viewport layout, not a
physical iPhone or Safari/WebKit engine.

## Verification and boundaries

25 automated geometry/API tests passed locally. They check manifold winding,
Euler characteristic for actual holes, nondegenerate triangles, flat volume,
determinism, invalid inputs, exports, real local D1 SQL, ownership isolation,
session hashes and logout. Two real-browser tests passed using the real local
mesh API, with no browser API response mocks.

AuthFor is a transport fixture in API tests. Production sign-in, registration,
MFA, outage behavior and cross-device sessions are not certified by those tests.
Browser tests open the sign-in dialog but do not create external accounts.
The successful `wrangler deploy --dry-run` proves packaging, not deployment.
These tests do not constitute full test coverage or manufacturing certification.

## Before production

1. Provision a real Conseiv D1 database in the chosen authorized Cloudflare
   account. Replace the explicit all-zero local placeholder in `wrangler.toml`.
   Apply the migration remotely only after confirming the selected account/DB.
2. Deploy to an explicitly chosen staging route, not by replacing all existing
   estate routes. `workers_dev`, previews and production routes are disabled.
3. Test real AuthFor accounts, cookies, logout, expired sessions and ownership
   on that HTTPS route. Implement MFA before promising access to MFA accounts;
   the current UI rejects an MFA challenge explicitly rather than bypassing it.
4. Exercise save/reopen/delete and actual exported models with a CAD tool and
   an engineering reviewer. Validate material/tooling-specific bend allowances.
5. Rate limiting on register/login is real and live-verified (see above). D1
   backup/restore is also real and live-verified: `npm run db:backup-verify`
   exports the actual remote `conseiv-studio` D1, restores that exact dump
   into a fresh local D1, and fails loudly if per-table row counts don't
   match the source exactly (verified 2026-09-20: users/sessions/assets/
   auth_attempts all matched). It is not scheduled anywhere yet - run it by
   hand before any production migration until a real backup cadence is
   decided. Still needed: monitoring and a scheduled (not just on-demand)
   backup, Safari and physical mobile QA, and privacy/terms review. Confirm
   the desired launch scope and preserve any legacy URLs before replacing
   the existing homepage.
6. If selling access, define pricing and integrate the existing VendyAI
   entitlement flow. This workbench does not currently take payments.

No LLM is used to invent geometry or certify it. There is no FEA, B-rep/STEP,
arbitrary prompt-to-CAD, assembly editor, structural approval, or fabrication
approval in this implementation. STL is unitless; filenames/comments identify
the intended millimeters, which importers must honor.
