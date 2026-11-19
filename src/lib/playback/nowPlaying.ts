/**
 * The words the system's Now Playing controls show for what plays (#461): iOS's lock screen and Control Center,
 * Android's media notification. A film shows its name; an episode its own title, with the show and the episode's
 * number under it (as on Discord, discordPresence.ts). The shell puts them there (src-tauri/src/player/background.rs).
 */
export interface NowPlayingText {
  title: string;
  subtitle?: string;
}

export interface NowPlayingEpisode {
  season: number;
  episode: number;
  title?: string;
}

export function nowPlayingText(name: string, episode?: NowPlayingEpisode): NowPlayingText {
  if (!episode) return { title: name };
  const code = episode.season === 0 ? `Special ${episode.episode}` : `S${episode.season} E${episode.episode}`;
  const own = episode.title?.trim();
  return own && own !== name ? { title: own, subtitle: `${name} · ${code}` } : { title: name, subtitle: code };
}
