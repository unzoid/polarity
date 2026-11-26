import { useState } from "react";
import { unhideTitle, useHiddenTitles } from "../../lib/library/hiddenTitles";
import { Button } from "../ui/Button";
import { ActionRow, Card, RowText } from "./rows";

/** Rows shown before "Show All". */
const FIRST = 12;

/**
 * Settings → Browsing → Hidden titles: what "Hide This Title" took out of Home, Movies, Series and
 * recommendations, newest first, each with Unhide (lib/library/hiddenTitles.ts).
 */
export function HiddenTitlesCard() {
  const list = useHiddenTitles();
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <div data-setting="hiddenTitles">
      <Card title="Hidden Titles">
        {!list.length && (
          <div className="settings-row">
            <RowText title="No hidden titles" caption="Hide a title from its card's menu or its page." />
          </div>
        )}
        {shown.map((h) => (
          <ActionRow key={h.id} title={h.name || h.id} caption={h.type === "movie" ? "Movie" : "Show"} label="Unhide" onClick={() => unhideTitle(h.id)} />
        ))}
        {list.length > FIRST && (
          <div className="settings-row">
            <RowText title={all ? `All ${list.length} shown` : `${list.length - FIRST} more`} />
            <Button onClick={() => setAll(!all)}>{all ? "Show Fewer" : "Show All"}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
