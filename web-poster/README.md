# Polarity website (poster redesign)

A redesign of `web/`: Libre Franklin, the logo's lavender with a deep indigo ink, heavy headlines and
full-width ink bands. Its Worker is named `polarity-poster`, so deploying it doesn't replace the live site.

SolidJS + Tailwind pages, with one Elysia route (`/api/release`) that reads the latest GitHub release.
Hosted on Cloudflare Workers: Cloudflare serves the built pages in `dist/`, the Worker answers `/api/*`.

```sh
bun install
bun run dev       # Vite dev server, /api mounted in it
bun run preview   # build, then run it in the real Workers runtime
bun run deploy    # build and deploy to Cloudflare
```

- Pages: `index.html`, `download/index.html`, `roadmap/index.html` (entries in `src/entries/`).
- Roadmap items: `src/data/roadmap.ts`.
- Data-source footnotes: `src/components/Footnotes.tsx`, kept in line with `docs/data-sources.md`.
- Screenshots in `public/` follow `AGENTS.md`: no unblurred posters, key art or title logos.
