/** The settings pages, in sidebar order. Icons live with the UI (components/settings/pages.ts). */
export type PageId =
  | "account"
  | "playback"
  | "sources"
  | "subtitles"
  | "appearance"
  | "browsing"
  | "anime"
  | "notifications"
  | "controls"
  | "controller"
  | "marketplace"
  | "addons"
  | "services"
  | "advanced"
  | "about";

export const PAGE_LABELS: Record<PageId, string> = {
  account: "Account",
  playback: "Playback",
  sources: "Sources",
  subtitles: "Subtitles & Audio",
  appearance: "Appearance",
  browsing: "Browsing",
  anime: "Anime",
  notifications: "Notifications",
  controls: "Controls & TV",
  controller: "Controller",
  marketplace: "Marketplace",
  addons: "Add-ons",
  services: "Services",
  advanced: "Advanced",
  about: "About & Updates",
};

export const PAGE_IDS = Object.keys(PAGE_LABELS) as PageId[];

export const isPageId = (id: unknown): id is PageId => typeof id === "string" && id in PAGE_LABELS;

/** A part of a long page with a view of its own: Settings / Playback / Player. */
export type PageSection = {
  id: string;
  label: string;
  /** What's in it, under its name in the page's list of sections. */
  caption: string;
  /** Its settings (schema ids), so a search result opens the section that holds it. */
  settings: readonly string[];
};

/**
 * The pages too long to take in at once, split into sections. Such a page opens on its list of sections (and
 * any setting in none of them, shown above the list: Anime's own switch); each section is a view of its own.
 */
export const PAGE_SECTIONS: Partial<Record<PageId, readonly PageSection[]>> = {
  playback: [
    {
      id: "autoplay",
      label: "Autoplay",
      caption: "Source selection, next episode and Still Watching",
      settings: ["autoPickSource", "autoplayNext", "autoplayCountdown", "stillWatchingAfter", "nextUpTiming"],
    },
    {
      id: "skipping",
      label: "Skipping",
      caption: "Intros, recaps and chapters",
      settings: ["autoSkip", "autoSkipRecaps", "autoSkipDelay", "preferFileChapters"],
    },
    {
      id: "resuming",
      label: "Resuming",
      caption: "Resume position and watched threshold",
      settings: ["resumePlayback", "resumeRewind", "watchedThreshold"],
    },
    {
      id: "downloads",
      label: "Downloads",
      caption: "Next-episode downloads",
      settings: ["autoDownloadNext", "autoDownloadRemoveWatched"],
    },
    {
      id: "player",
      label: "Player",
      caption: "Fullscreen, minimize, speed and Discord",
      settings: ["startFullscreen", "pauseOnMinimize", "discordPresence", "discordJoin", "rememberSpeed"],
    },
    {
      id: "controls",
      label: "On-Screen Controls",
      caption: "Clock, skip step, pause behavior, clicks and scroll",
      settings: [
        "timeDisplay",
        "showPlayingFormat",
        "loadingDetails",
        "seekStep",
        "controlsHideSecs",
        "pauseShowsControls",
        "pauseDetails",
        "holdSpeed",
        "clickAction",
        "wheelAction",
      ],
    },
  ],
  subtitles: [
    {
      id: "languages",
      label: "Languages",
      caption: "Audio, subtitles, SDH and second subtitle",
      settings: ["audioLanguage", "subtitleLanguage", "subtitleMode", "preferSdh", "secondSubtitles", "secondSubtitleLanguage"],
    },
    {
      id: "style",
      label: "Subtitle Style",
      caption: "Font, size, colour, position and timing",
      settings: [
        "subtitleStyle",
        "subtitleDelay",
        "subtitleFont",
        "subtitleSize",
        "subtitlePosition",
        "subtitleColor",
        "subtitleOpacity",
        "subtitleOutline",
        "subtitleBackground",
      ],
    },
    {
      id: "sound",
      label: "Sound",
      caption: "Dialogue, volume leveling, dynamic range and passthrough",
      settings: ["dialogueBoost", "volumeLeveling", "drcProfile", "maxVolume", "passthrough"],
    },
  ],
  browsing: [
    {
      id: "general",
      label: "General",
      caption: "Start page, language, family and search",
      settings: ["startPage", "language", "viewingLimit", "viewingHideUnrated", "matureContent", "searchSuggestions", "saveRecentSearches"],
    },
    {
      id: "pages",
      label: "Home & Title Pages",
      caption: "Carousel, Continue Watching, hidden titles, trailers and calendar",
      settings: ["heroAutoplay", "showContinueWatching", "hideWatched", "hiddenTitles", "trailerAutoplay", "trailerSound", "showCalendar"],
    },
    {
      id: "cards",
      label: "Cards & Episodes",
      caption: "Cards, ratings, episodes and spoilers",
      settings: [
        "showCardTitles",
        "showCardDetails",
        "showCardRatings",
        "cardRatingPosition",
        "ratingColors",
        "episodeLayout",
        "hideEpisodeThumbs",
        "hideEpisodeDescriptions",
      ],
    },
  ],
  anime: [
    {
      id: "language",
      label: "Language",
      caption: "Titles, voices, audio and subtitles",
      settings: ["animeTitles", "animeVoices", "animeAudioLanguage", "animeSubtitleLanguage"],
    },
    {
      id: "browsing",
      label: "Shelves & Cards",
      caption: "Shelves, cards, scores and schedule",
      settings: ["animeShelves", "animeCardTitles", "animeCardPeek", "animeCardScores", "animeScoreFormat", "animeCardCountdown", "animeSeparateEntries", "animeScheduleAll"],
    },
    {
      id: "episodes",
      label: "Episodes & Sources",
      caption: "Filler, recaps, franchise and release groups",
      settings: [
        "animeReadOn",
        "animeHideUnplayable",
        "animeSkipFiller",
        "animeHideRecaps",
        "animeNo4k",
        "animeSpoilerTags",
        "animePreferredGroups",
      ],
    },
  ],
};

/** The section of `page` that holds the setting `id`, if the page has sections and it's in one. */
export const sectionOf = (page: PageId, id: string) => PAGE_SECTIONS[page]?.find((s) => s.settings.includes(id));
