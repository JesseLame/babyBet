# Baby Bet Board

A simple static website for tracking a compact list of bets on a child's birth date and name.

## What it does

- Tracks a list of bets with predicted date, predicted name, who made the guess, and time
- Keeps the layout compact with a small create button and list-first view
- Caches everything in the browser with `localStorage`
- Can sync the same list across browsers when Supabase is configured
- Runs as a Vite app that can be deployed to Vercel with build-time environment variables

## Shared storage

To share the same data across devices, connect the app to Supabase:

1. Create a Supabase project.
2. Run the schema in [`supabase-schema.sql`](supabase-schema.sql).
3. Add the following Vercel environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Deploy the app on Vercel. The build step injects those values at build time.
5. Share the deployed URL directly. The app uses one shared list for the site.

The Supabase publishable key is safe to expose to the browser, but it should still be stored as a Vercel environment variable so it does not live in the repository. Never use a `service_role` or `sb_secret` key in this app.
The schema keeps the old `board_key` column for compatibility with existing data, but the app no longer asks you to manage any board secret.

## Local development

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

If you want local Supabase sync while developing, create a `.env.local` file from [`.env.example`](.env.example) and fill in the two `VITE_*` values.

You can also run a production build locally with:

```bash
npm run build
```

If Supabase is not configured, the app stays in local-only mode and still works as a single-device tracker.

## Deploy on Vercel

1. Import the repository into Vercel.
2. Set the two `VITE_*` environment variables in the Vercel project settings.
3. Let Vercel use the default Vite build command and output directory.
4. Deploy the project.

## Notes

- The design is intentionally lightweight so it stays easy to maintain.
- If you want, the next upgrade can add login-based access control, row editing, or a nicer share card.
