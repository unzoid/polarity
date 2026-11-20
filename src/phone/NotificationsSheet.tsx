import { useMemo } from "react";
import { Img } from "../components/Img";
import { Sheet } from "../components/Sheet";
import { useCalendar } from "../lib/catalog";
import { useNavigation } from "../lib/router";
import { cardArtUrl } from "../lib/ui";
import { notifications } from "./store";

const DAY = 86_400_000;

/**
 * The bell: what's new for you, as Netflix's Notifications sheet is. Polarity's news is the episodes of your
 * shows that came out this past week (the Calendar's), newest first; a tap opens the show on that episode.
 */
export function NotificationsSheet() {
  const open = notifications.use();
  return (
    <Sheet open={open} onClose={() => notifications.set(false)} title="Notifications" full closeButton>
      {open && <NotificationList />}
    </Sheet>
  );
}

function NotificationList() {
  const { entries, loading } = useCalendar(true);
  const { navigate } = useNavigation();
  const today = new Date().setHours(0, 0, 0, 0);
  const recent = useMemo(() => entries.filter((e) => e.day <= today).sort((a, b) => b.day - a.day), [entries, today]);
  if (loading && !recent.length) return <div className="ph-notes-empty" aria-busy><span className="ph-spinner" /></div>;
  if (!recent.length)
    return (
      <div className="ph-notes-empty">
        <p>New episodes of the shows you follow show up here.</p>
      </div>
    );
  return (
    <ul className="ph-notes">
      {recent.map(({ show, video, day }) => {
        const ago = Math.round((today - day) / DAY);
        return (
          <li key={video.id}>
            <button
              type="button"
              onClick={() => {
                notifications.set(false);
                navigate({ name: "detail", type: "series", id: show.id, episode: video.id });
              }}
            >
              <span className="ph-notes-still">
                <Img src={cardArtUrl(video.thumbnail ?? show.background, "landscape")} fallbacks={[cardArtUrl(show.background, "landscape")]} alt="" loading="lazy" />
              </span>
              <span className="ph-notes-text">
                <strong>New Episode</strong>
                <span>
                  {show.name}: S{video.season} E{video.episode}
                  {video.title?.trim() ? ` · ${video.title.trim()}` : ""}
                </span>
                <small>{ago === 0 ? "Today" : ago === 1 ? "Yesterday" : `${ago} days ago`}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
