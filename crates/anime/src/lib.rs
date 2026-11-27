//! Anime data the app fetches itself rather than from an addon, with what it
//! keeps of it on disk. Tauri-free, so it is tested here; `src-tauri` gives it
//! a cache folder and exposes it as commands.
//!
//! - [`fillers`]: which episodes are filler or recap (Jikan, then
//!   animefillerlist.com), cached for a day in one JSON file.
//! - [`anime_lists`]: Fribb/anime-lists, the local O(1) cross-id and franchise
//!   index, downloaded once and refreshed weekly.
//! - [`catalog`]: Show-first anime catalog, seasonal feeds, schedules, browse
//!   and lazy character details powered by Jikan v4 with persistent disk cache.

pub mod anime_lists;
pub mod catalog;
pub mod fillers;

pub use anime_lists::{AnimeKey, AnimeLists, AnimeMapping};
pub use catalog::{
    AnimeAiring, AnimeBrowsePage, AnimeBrowseQuery, AnimeCatalog, AnimeCharacter, AnimeExternalLink, AnimeHome,
    AnimeItem, AnimeRanking, AnimeRichDetails, AnimeShowInfo, AnimeTag, AnimeTitle, AnimeVoiceActor, JikanEpisode,
};
pub use fillers::{EpisodeFlags, Fillers, Source};
