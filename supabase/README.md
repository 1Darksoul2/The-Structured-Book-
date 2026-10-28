# MyFundedBook backend (Supabase)

The front end already speaks to Supabase when `HOSTED = true`. That build is `web/index.html`.

1. Create a project at supabase.com.
2. SQL Editor: paste and run `supabase/setup.sql`.
3. Authentication > Providers: keep Email on. For quick testing, turn off "Confirm email".
   Authentication > URL Configuration: set Site URL to wherever you host `web/index.html`
   (needed for confirm and password-reset links).
4. Project Settings > API Keys: copy the Project URL and the publishable (anon) key.
5. Host `web/index.html` anywhere static (Netlify, Vercel, Cloudflare Pages, GitHub Pages) or open it locally.
   On first load it asks for the URL and key, then shows sign in / create account.
   To skip that prompt, put them in `SUPA_URL` / `SUPA_KEY` near line 618 of `web/index.html`
   (the publishable key is safe to ship; RLS protects the data).

Data model: table `journal(user_id, col, id, data jsonb, updated_at)`, with `col` one of
trades, notes, playbooks, meta. Screenshots go to private bucket `shots` under `<user_id>/`.
