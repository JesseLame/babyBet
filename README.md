# Baby Bet Board

A simple static website for tracking a compact list of bets on a child's birth date and name.

## What it does

- Tracks a list of bets with predicted date, predicted name, stake, and notes
- Keeps the layout compact with a small create button and list-first view
- Caches everything in the browser with `localStorage`
- Can sync the same list across browsers when Supabase is configured
- Works as a free GitHub Pages site with no backend required for local use

## Shared storage

To share the same data across devices, connect the page to Supabase:

1. Create a Supabase project.
2. Run the schema in [`supabase-schema.sql`](supabase-schema.sql).
3. In GitHub, add repository secrets named `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
4. In repository settings, switch GitHub Pages to deploy from GitHub Actions.
5. Push to the `main` branch and let the workflow generate `config.js` during deployment.
6. Share an invite link that includes a board key, for example `https://your-site.github.io/#board=your-private-board-key`.

The board key is the shared secret for that invite link. Anyone with the link can use the board, so keep it private.
The Supabase publishable key is safe to expose to the browser, but it should still be stored as a GitHub secret so it does not live in the repository. Never use a `service_role` or `sb_secret` key in this app.
The first time the new list view sees an old single-board row, it copies that record into the new `baby_bet_bets` table so existing boards do not start empty.

## GitHub Pages deploy

This repo includes a GitHub Actions workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

- The checked-in [`config.js`](config.js) keeps local development working without secrets.
- During deployment, the workflow replaces that file in the Pages artifact with values from GitHub Secrets.
- The deployed site reads the generated file before `script.js` starts, so Supabase sync is enabled automatically when the secrets exist.

## Run locally

Open `index.html` in a browser, or serve the folder with any static server.

If Supabase is not configured, the app stays in local-only mode and still works as a single-device tracker.

## Publish on GitHub Pages

1. Push the repo to GitHub.
2. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as repository secrets.
3. In `Settings` -> `Pages`, set the source to `GitHub Actions`.
4. Push to `main` or run the workflow manually.
5. Open the Pages URL shown by GitHub once deployment finishes.

## Notes

- The design is intentionally lightweight so it stays easy to maintain.
- If you want, the next upgrade can add login-based access control, row editing, or a nicer share card.
