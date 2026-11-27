import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { createPlaylistOf, isLetterboxdListLink, listFilms, matchFilm, MAX_PLAYLISTS, yearOf, type LetterboxdFilm } from "../../lib/library";
import { concurrency } from "../../lib/net";
import type { MetaPreview } from "../../lib/types";
import { Close, Download } from "../icons";
import { Button, iconButtonClass } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { useFormFactor } from "../../lib/ui";
import { FamilyTray } from "../settings/FamilyTray";

/**
 * Import Playlist: a public Letterboxd list, from its link, made into a playlist in the list's order. The list
 * is read on this device (src-tauri/src/letterboxd.rs), each film is found in the catalog by title and year as
 * the export import does, and films that match nothing, or more than one, are left for the user to pick or
 * leave out before the playlist is made.
 */

interface Entry {
  film: LetterboxdFilm;
  found?: MetaPreview;
  choices: MetaPreview[];
  picked?: MetaPreview;
}

interface Read {
  name: string;
  entries: Entry[];
  truncated: boolean;
}

/** Searches running at once, as the export import runs them. */
const SEARCHES = 2;

const titled = (name: string, year?: number) => (year ? `${name} (${year})` : name);
const films = (n: number) => `${n.toLocaleString()} ${n === 1 ? "film" : "films"}`;

export function ImportPlaylistDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [link, setLink] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  // Bumped on every run and on close, so a run that's no longer wanted leaves nothing behind.
  const run = useRef(0);
  const phone = useFormFactor().form === "phone";

  const reset = () => {
    run.current++;
    setStep(null);
    setError(null);
    setRead(null);
  };
  const close = () => {
    reset();
    setLink("");
    onClose();
  };

  const start = async () => {
    const mine = ++run.current;
    const live = () => run.current === mine;
    setError(null);
    setRead(null);
    try {
      setStep("Reading the list…");
      const list = await api.letterboxdList(link.trim());
      if (!live()) return;
      if (!list.films.length) throw new Error("That list has no films in it.");
      const entries: Entry[] = listFilms(list.films).map((film) => ({ film, choices: [] }));
      const search = concurrency(SEARCHES);
      let done = 0;
      setStep(`Finding films… 0 of ${entries.length.toLocaleString()}`);
      await Promise.all(
        entries.map((e) =>
          search(async () => {
            if (!live()) return;
            const m = await matchFilm(e.film, api.searchMovies).catch(() => ({ choose: [] as MetaPreview[] }));
            if ("found" in m) e.found = m.found;
            else e.choices = m.choose;
            if (live()) setStep(`Finding films… ${(++done).toLocaleString()} of ${entries.length.toLocaleString()}`);
          }),
        ),
      );
      if (live()) setRead({ name: list.name, entries, truncated: list.truncated });
    } catch (e) {
      if (live()) setError(errorMessage(e));
    } finally {
      if (live()) setStep(null);
    }
  };

  const pick = (entry: Entry, film: MetaPreview) =>
    setRead((r) => r && { ...r, entries: r.entries.map((e) => (e === entry ? { ...e, picked: e.picked?.id === film.id ? undefined : film } : e)) });

  const create = () => {
    if (!read) return;
    const titles = read.entries.flatMap((e) => (e.found ?? e.picked ? [(e.found ?? e.picked)!] : []));
    const made = createPlaylistOf(read.name, titles);
    if (!made) {
      setError(`You already have ${MAX_PLAYLISTS} playlists. Delete one to make room.`);
      return;
    }
    close();
    onCreated(made.id);
  };

  const busy = step !== null;
  const found = read?.entries.filter((e) => e.found).length ?? 0;
  const toPick = read?.entries.filter((e) => !e.found) ?? [];
  const chosen = found + toPick.filter((e) => e.picked).length;
  const status = step ?? (link.trim() && !isLetterboxdListLink(link) ? "That doesn't look like a link to a Letterboxd list." : "");
  const summary = read && (
    <>
      Found {found.toLocaleString()} of {films(read.entries.length)}.{read.truncated && " The list is longer than a playlist holds, so only its first 500 films were read."}
      {toPick.length > 0 && " Pick the right film for the rest, or leave them out."}
    </>
  );
  const picks = toPick.length > 0 && (
    <ul className="import-playlist-picks">
      {toPick.map((e) => (
        <li key={e.film.key}>
          <span className="import-playlist-film">{titled(e.film.name, e.film.year)}</span>
          {e.choices.length ? (
            <span className="import-playlist-choices">
              {e.choices.map((m) => (
                <button key={m.id} type="button" className="import-playlist-choice" aria-pressed={e.picked?.id === m.id} onClick={() => pick(e, m)}>
                  {titled(m.name, yearOf(m.releaseInfo))}
                </button>
              ))}
            </span>
          ) : (
            <span className="import-playlist-none">Not found, left out</span>
          )}
        </li>
      ))}
    </ul>
  );

  // A phone: the settings' tray, as its other dialogs are.
  if (phone)
    return (
      <FamilyTray open={open} onClose={close} title={read ? read.name : "Import Playlist"} stepKey={read ? "picks" : "link"}>
        {!read ? (
          <>
            <p className="ft-desc">Paste a link to a public Letterboxd list. Its films are found in your catalog and kept in the list's order.</p>
            <form
              className="ft-input-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && isLetterboxdListLink(link)) void start();
              }}
            >
              <input
                className="text-field"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setError(null);
                }}
                placeholder="letterboxd.com/name/list/…"
                aria-label="Letterboxd list link"
                inputMode="url"
                enterKeyHint="go"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                disabled={busy}
                autoFocus
              />
              <p className="ft-import-status" role="status">
                {status}
              </p>
              {error && (
                <p className="ft-desc-error" role="alert">
                  {error}
                </p>
              )}
              <div className="ft-actions">
                <button type="submit" className="ft-pill ft-pill-cta" disabled={busy || !isLetterboxdListLink(link)}>
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="ft-desc">{summary}</p>
            {picks}
            {error && (
              <p className="ft-desc-error" role="alert">
                {error}
              </p>
            )}
            <div className="ft-actions ft-actions-stack">
              <button type="button" className="ft-pill ft-pill-cta" disabled={!chosen} onClick={create}>
                {chosen ? `Make Playlist of ${films(chosen)}` : "No films to add"}
              </button>
              <button type="button" className="ft-pill ft-pill-secondary" onClick={reset}>
                Use Another Link
              </button>
            </div>
          </>
        )}
      </FamilyTray>
    );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="party-dialog-scrim" />
        <Dialog.Popup className="party-dialog import-playlist">
          <div className="party-dialog-icon" aria-hidden>
            <Download size={22} />
          </div>
          <Dialog.Title className="party-dialog-title">{read ? read.name : "Import Playlist"}</Dialog.Title>
          {!read ? (
            <>
              <Dialog.Description className="party-dialog-text">
                Paste a link to a public Letterboxd list. Its films are found in your catalog and kept in the list's order.
              </Dialog.Description>
              <form
                className="import-playlist-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy && isLetterboxdListLink(link)) void start();
                }}
              >
                <TextField
                  look="block"
                  value={link}
                  onChange={(v) => {
                    setLink(v);
                    setError(null);
                  }}
                  placeholder="letterboxd.com/name/list/…"
                  aria-label="Letterboxd list link"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  autoFocus
                />
                <Button variant="primary" busy={busy} disabled={busy || !isLetterboxdListLink(link)}>
                  Import
                </Button>
              </form>
              <p className="import-playlist-status" role="status">
                {status}
              </p>
            </>
          ) : (
            <>
              <Dialog.Description className="party-dialog-text">{summary}</Dialog.Description>
              {picks}
              <div className="import-playlist-actions">
                <Button variant="primary" disabled={!chosen} onClick={create}>
                  {chosen ? `Make Playlist of ${films(chosen)}` : "No films to add"}
                </Button>
                <Button onClick={reset}>Use Another Link</Button>
              </div>
            </>
          )}
          {error && (
            <p className="import-playlist-error" role="alert">
              {error}
            </p>
          )}
          <Dialog.Close className={iconButtonClass("party")} aria-label="Close">
            <Close size={18} />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
