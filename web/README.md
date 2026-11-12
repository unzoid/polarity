# Polarity website

Inter, indigo-tinted neutrals around the app's #5E5CE6 and the logo's #A7ABFF, following the system's light or
dark mode. Large rounded cards carry fluted glass drawn in WebGL (`src/components/Flutes.tsx`), with flutes shaped
as the logo's four-point star, rings, rays or straight reeds.

SolidJS + Tailwind pages, with two Elysia routes that read GitHub: `/api/release` (the latest release) and
`/api/issues` (recently fixed issues, shown in the Open source section).
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
