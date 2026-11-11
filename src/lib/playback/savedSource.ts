import type { Progress, RankedStream, Stream } from "../types";

/** One source's identity, as the Sources list tells them apart: its link, a torrent's file, or a YouTube video. */
export function sourceKey(st: Stream): string {
  return st.url ?? (st.infoHash ? `${st.infoHash.toLowerCase()}#${st.fileIdx ?? 0}` : st.ytId) ?? "";
}

/** The saved stream's key when it was saved for this very title (`metaId`, the canonical id) and episode. */
function savedKey(saved: Pick<Progress, "metaId" | "videoId" | "stream"> | null | undefined, want: { metaId: string; videoId: string }) {
  const st = saved?.stream;
  return st && saved.metaId === want.metaId && saved.videoId === want.videoId ? sourceKey(st) || undefined : undefined;
}

/**
 * The source to go on with from saved progress (#394): only the one saved for this very title and episode, and
 * only while the add-ons still offer it for this episode (`answer`), as they give it now. Undefined otherwise:
 * the answer is ranked as for a first play, so nothing the Sources list couldn't offer is played.
 */
export function savedSource(
  saved: Pick<Progress, "metaId" | "videoId" | "stream"> | null | undefined,
  want: { metaId: string; videoId: string },
  answer: readonly RankedStream[],
): RankedStream | undefined {
  const key = savedKey(saved, want);
  return key ? answer.find((r) => sourceKey(r.stream) === key) : undefined;
}

/** The episode's finished download (`downloaded`), when that's what it was last played from: it goes on without asking. */
export function savedDownload(
  saved: Pick<Progress, "metaId" | "videoId" | "stream"> | null | undefined,
  want: { metaId: string; videoId: string },
  downloaded: Stream | undefined,
): Stream | undefined {
  const key = savedKey(saved, want);
  return key && downloaded && sourceKey(downloaded) === key ? downloaded : undefined;
}
