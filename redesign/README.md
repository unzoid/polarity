# Polarity's interface, from zero

A new interface for Polarity, built beside the current one. It shares the logic layer (`src/lib`: data,
the router, the account, the platform bridge) and nothing else: no component, screen or stylesheet of the
current app is used here, and nothing here changes them.

## Direction

- **Product.** A player and library for the films and series you watch, from sources you add yourself,
  on desktop, phone and TV.
- **Character.** Unhurried, exact, a little warm.
- **World.** A repertory cinema at night: the printed programme, the projectionist's running-time sheet.
  Neutrals are graphite with a faint warm cast. Artwork is shown large and never tints the interface.
- **Moments.** The artwork itself, full and steady, and running times drawn to scale.
- **Signature.** The running-time line (`src/ui/RunLine.tsx`). Every film or episode shows its length on
  one shared scale, three hours across, with what you've watched drawn on it in the accent. It appears where
  the length is known: the featured title, a title's page, its episode rows, Continue Watching, and (later)
  the scrubber. Browse cards don't carry it: a catalog entry has no running time.

The accent is the logo's lavender (`#a7abff`), used only for progress, selection and focus. The primary
action is an off-white fill. Type is Instrument Sans for the interface, Instrument Serif only for a
title's name set large, and Geist Mono for running times, dates and counts.

## Running it

```bash
bunx vite --port 5200
```

Then open `http://localhost:5200/redesign/fake.html` (the stand-in shell with made-up data).

## What's built

Phase 1, the proof: tokens, type and primitives, the shell (sidebar on desktop, tabs on a phone), Home and
the title page. Every other page shows a note that it isn't built yet.

Still to come, in order:

1. Player and its source list, Search, Series and Movies, Library with its collections and playlists,
   Person, Calendar.
2. Anime, Settings (inside the shell, not a second window), sign-in, onboarding, profiles and PINs, watch
   parties and friends, toasts and menus (right-click and long-press).
3. TV mode, the light scheme and the user's themes, then switching the shell over to `redesign/index.html`
   and removing the old interface.
