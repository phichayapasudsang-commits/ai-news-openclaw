# ai-news-web

Minimal Vite + React SPA that reads AI news from Supabase and shows
the latest stories in English and Thai.

## Stack

- **Vite 5** + **React 18** + **TypeScript**
- **Tailwind CSS 3** for styling
- **@supabase/supabase-js** for data (anon key only - safe in browser)
- Deployed as a **static SPA** on Vercel

## Files

```
web/
├── index.html              # HTML entry
├── package.json            # deps + npm scripts
├── tsconfig.json           # project references
├── tsconfig.app.json       # app compiler config
├── tsconfig.node.json      # vite.config.ts compiler config
├── vite.config.ts          # vite + React plugin
├── tailwind.config.ts      # tailwind content globs
├── postcss.config.js       # tailwind + autoprefixer
├── vercel.json             # SPA rewrites + build config
├── .env.example            # Supabase URL + anon key
├── .gitignore              # blocks node_modules, dist, .env
└── src/
    ├── main.tsx            # React mount point
    ├── App.tsx             # top-level page
    ├── index.css           # tailwind directives
    ├── types.ts            # Article / Language
    ├── lib/
    │   └── supabase.ts     # createClient + fetchArticles()
    └── components/
        ├── ArticleCard.tsx     # one article card
        ├── ArticleList.tsx     # responsive grid wrapper
        ├── LanguageToggle.tsx  # EN / TH switch
        ├── EmptyState.tsx      # zero-data placeholder
        ├── LoadingState.tsx    # spinner
        └── ErrorState.tsx      # error + retry
```

## Setup

```bash
cd web
npm install
cp .env.example .env       # fill in the two Supabase keys
```

| Key | Source |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase dashboard -> Project -> Settings -> API |
| `VITE_SUPABASE_ANON_KEY` | same place (this one is **safe** for the browser) |

⚠️ Use the **anon** key here, not the service_role key. The anon key is
restricted by Row Level Security — make sure your `articles` table has
a SELECT policy for the `anon` role (or for `public`).

### Required SQL policy

```sql
-- Allow anonymous SELECT on articles for the web app
create policy "anon can read articles"
  on articles for select
  to anon
  using (true);
```

## Run

```bash
npm run dev         # http://localhost:5173
npm run build       # production bundle in dist/
npm run preview     # serve dist/ locally
npm run typecheck   # tsc --noEmit
```

## Deploy to Vercel

1. Push this folder to GitHub (or run `vercel` CLI in this folder).
2. In Vercel:
   - **Root Directory**: `web`
   - **Build Command**: `npm run build` (auto-detected from `vercel.json`)
   - **Output Directory**: `dist` (auto-detected)
3. Add the env vars in Project Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Done ✅

Every push to `main` triggers a new production deploy automatically.

## Where the data comes from

This SPA reads from the `articles` table written by the sibling
`ai-news-agent` pipeline (Researcher → Deduplicator → Analyst → QA).
Run that pipeline (or the cron job) to populate the table; refresh
the page to see new entries.
