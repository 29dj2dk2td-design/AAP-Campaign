# Ward 27 Campaign Site

Hindi/English campaign home page for Ward 27, Chandigarh, plus a password-protected feedback inbox.

- `public/index.html` the public site (feedback form posts to `/api/feedback`)
- `public/admin.html` the inbox at `/admin`
- `src/worker.js` Cloudflare Worker: serves pages, stores feedback in D1, admin API
- `schema.sql` D1 table
- `python3 build.py` embeds the pages into `dist/worker.js`

Deploy: `python3 build.py && npx wrangler deploy`, then set the admin password with `npx wrangler secret put ADMIN_PASSWORD`.
