import "../styles/screens.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DownloadButton } from "../components/DownloadButton";
import { TrashLid, useConfirmDelete } from "../components/ConfirmDeleteButton";
import { ChevronDown, Download, Watched } from "../components/icons";
import { Img } from "../components/Img";
import { StillPlaceholder } from "../components/StillPlaceholder";
import { errorMessage } from "../lib/errors";
import { episodeCode, formatBytes } from "../lib/format";
import {
  DOWNLOAD_FILTERS,
  activeProgress,
  bytesOnDisk,
  downloadFraction,
  downloadsSummary,
  filterTitles,
  folderChoice,
  groupDownloads,
  isActive,
  keepOpen,
  localStream,
  pickDownloadFolder,
  readDownloadsView,
  removeDownloads,
  saveDownloadsView,
  setDownloadFolder,
  sortTitles,
  useAllLeaving,
  useAutoDownloads,
  useDownloads,
  useDownloadsStorage,
  useLeaving,
  watchedFraction,
  watchedIds,
  watchedSet,
  type Download as DownloadRecord,
  type DownloadTitle,
  type DownloadsView,
} from "../lib/library";
import { useProgressOf } from "../lib/net";
import { useNavigation } from "../lib/router";
import { usePresence } from "../lib/ui";
import { IconBack, IconPlayRing } from "../phone/icons";
import { BarActions } from "./Bar";
import type { Chrome } from "./Nav";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const seasonName = (s: number) => (s === 0 ? "Specials" : `Season ${s}`);

function formatLine(d: DownloadRecord, includeKind = false) {
  const ep = d.season != null && d.episode != null ? episodeCode(d.season, d.episode) : null;
  const f = downloadFraction(d);
  const status =
    d.state === "done"
      ? formatBytes(bytesOnDisk(d))
      : d.state === "failed"
        ? "Failed"
        : `${d.state === "paused" ? "Paused" : "Downloading"}${f != null ? ` · ${Math.round(f * 100)}%` : ""}`;
  return [includeKind ? "Movie" : null, ep, d.quality, status].filter(Boolean).join(" · ");
}

type Selection = { has: (id: string) => boolean; set: (ids: string[], on: boolean) => void } | null;

/**
 * Desk Downloads: clean, single-header Netflix-dark downloads page with minimal chrome,
 * quiet storage/folder controls, lightweight filter pills, and flat title/episode rows.
 */
export function DeskDownloads({ onBack, chrome }: { onBack: () => void; chrome: Chrome }) {
  const { data } = useDownloads();
  const { data: storage } = useDownloadsStorage();
  const all = useMemo(() => data ?? [], [data]);
  const metaIds = useMemo(() => [...new Set(all.map((d) => d.metaId))], [all]);
  const progress = useProgressOf(metaIds);
  const watched = useMemo(() => watchedSet(progress, watchedFraction()), [progress]);
  const lastWatched = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of progress) m.set(p.metaId, Math.max(m.get(p.metaId) ?? 0, p.updatedAt));
    return m;
  }, [progress]);

  const [view, setView] = useState<DownloadsView>(readDownloadsView);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selectBar = usePresence(selected, 220);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const update = (patch: Partial<DownloadsView>) =>
    setView((v) => {
      const next = { ...v, ...patch };
      saveDownloadsView(next);
      return next;
    });

  const toggleOpen = useCallback(
    (key: string) =>
      setView((v) => {
        const next = { ...v, open: v.open.includes(key) ? v.open.filter((k) => k !== key) : [...v.open, key] };
        saveDownloadsView(next);
        return next;
      }),
    [],
  );

  const selection: Selection = useMemo(
    () =>
      selected && {
        has: (id: string) => selected.has(id),
        set: (ids: string[], on: boolean) =>
          setSelected((s) => {
            const next = new Set(s);
            for (const id of ids) on ? next.add(id) : next.delete(id);
            return next;
          }),
      },
    [selected],
  );

  const active = useMemo(() => all.filter(isActive), [all]);
  const done = useMemo(() => all.filter((d) => !isActive(d)), [all]);
  const doneKey = done.map((d) => `${d.id}:${bytesOnDisk(d)}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const finished = useMemo(() => groupDownloads(done, watched, lastWatched), [doneKey, watched, lastWatched]);
  const shownTitles = useMemo(
    () => (view.filter === "active" ? [] : sortTitles(filterTitles(finished, view.filter, ""), view.sort)),
    [finished, view.filter, view.sort],
  );
  const shownActive = useMemo(
    () =>
      groupDownloads(active, watched, lastWatched)
        .filter((t) => filterTitles([t], view.filter, "").length)
        .flatMap((t) => t.items),
    [active, watched, lastWatched, view.filter],
  );

  const live = data !== undefined;
  useEffect(() => {
    if (!live) return;
    const open = keepOpen(view.open, finished);
    if (open.length !== view.open.length) update({ open });
    setSelected((s) =>
      s && [...s].some((id) => !all.some((d) => d.id === id)) ? new Set([...s].filter((id) => all.some((d) => d.id === id))) : s,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, finished, live]);

  const { count, bytes } = downloadsSummary(all);
  const summaryParts = [
    count ? plural(count, "download") : null,
    count ? formatBytes(bytes) : null,
    storage?.free != null ? `${formatBytes(storage.free)} free` : null,
  ].filter(Boolean);
  const canPickFolder = folderChoice() === "dialog" && !!storage;
  const runFolder = (fn: () => Promise<unknown>) => {
    setFolderBusy(true);
    setFolderError(null);
    fn()
      .catch((e: unknown) => setFolderError(errorMessage(e)))
      .finally(() => setFolderBusy(false));
  };

  const hasShows = all.some((d) => d.type === "series");
  const hasMovies = all.some((d) => d.type !== "series");
  const showFilters = all.length > 0 && ((hasShows && hasMovies) || active.length > 0 || view.filter !== "all");
  const allWatched = watchedIds(done, watched);
  const shownIds = [...shownActive, ...shownTitles.flatMap((t) => t.items)].map((d) => d.id);

  return (
    <div className="dk-page dk-dl-page" data-selecting={selected ? "" : undefined}>
      <header className="dk-bar dk-pagebar" data-tauri-drag-region>
        <div className="dk-bar-lead" data-tauri-drag-region>
          <button type="button" className="dk-round dk-back" aria-label="Back" onClick={onBack}>
            <IconBack size={22} stroke={2.2} />
          </button>
          <h1 className="dk-bar-title">Downloads</h1>
        </div>
        {chrome === "tabs" && <BarActions />}
      </header>

      <div className="dk-scroll">
        <div className="dk-dl-body">
          <div className="dk-dl-top">
            <div className="dk-dl-meta">
              {summaryParts.length > 0 && <p className="dk-dl-summary tabular">{summaryParts.join(" · ")}</p>}
              {canPickFolder && storage && (
                <p className="dk-dl-folder" title={storage.dir}>
                  <span className="dk-dl-folder-path">{storage.dir}</span>
                  <button type="button" className="dk-dl-link" disabled={folderBusy} onClick={() => runFolder(pickDownloadFolder)}>
                    Change folder
                  </button>
                  {storage.custom && (
                    <button type="button" className="dk-dl-link" disabled={folderBusy} onClick={() => runFolder(() => setDownloadFolder(null))}>
                      Reset
                    </button>
                  )}
                </p>
              )}
              {folderError && <p className="dk-dl-error">{folderError}</p>}
            </div>

            {all.length > 0 && (
              <div className="dk-dl-top-actions">
                {!selected && allWatched.length > 0 && <QuietBulkDelete ids={allWatched} label={`Clear watched (${allWatched.length})`} />}
                <button
                  type="button"
                  className="dk-dl-pill"
                  data-active={selected ? "" : undefined}
                  aria-pressed={!!selected}
                  onClick={() => setSelected(selected ? null : new Set())}
                >
                  {selected ? "Done" : "Select"}
                </button>
              </div>
            )}
          </div>

          {showFilters && (
            <div className="dk-dl-filters" role="tablist" aria-label="Filter downloads">
              {DOWNLOAD_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={view.filter === f.value}
                  className="dk-chip"
                  onClick={() => update({ filter: f.value })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {data && all.length === 0 && (
            <div className="dk-dl-empty">
              <span className="dk-dl-empty-icon" aria-hidden>
                <Download size={26} />
              </span>
              <h2>No downloads yet</h2>
              <p>Download movies or episodes from any title page to watch them offline.</p>
            </div>
          )}

          {shownActive.length > 0 && <ActiveBlock list={shownActive} selection={selection} />}

          {shownTitles.length > 0 && (
            <div className="dk-dl-list">
              {shownTitles.map((t) => (
                <DeskTitleGroup
                  key={t.key}
                  title={t}
                  watched={watched}
                  open={view.open}
                  onToggle={toggleOpen}
                  selection={selection}
                />
              ))}
            </div>
          )}

          {all.length > 0 && !shownActive.length && !shownTitles.length && (
            <div className="dk-dl-empty">
              <p>{view.filter === "active" ? "Nothing is downloading right now." : "No downloads in this category."}</p>
            </div>
          )}
        </div>
      </div>

      {selectBar.shown && (
        <div className="dk-dl-selectbar" role="region" aria-label="Selection" data-leaving={selectBar.leaving || undefined}>
          <button
            type="button"
            className="dk-dl-pill"
            disabled={selectBar.leaving}
            onClick={() => setSelected(selectBar.shown!.size === shownIds.length ? new Set() : new Set(shownIds))}
          >
            {selectBar.shown.size === shownIds.length && shownIds.length ? "Deselect all" : "Select all"}
          </button>
          <span className="dk-dl-selectbar-count tabular" aria-live="polite">
            {selectBar.shown.size ? `${selectBar.shown.size} selected` : "Select downloads"}
          </span>
          <QuietBulkDelete
            ids={[...selectBar.shown]}
            label="Delete"
            disabled={selectBar.leaving || !selectBar.shown.size}
            onDone={() => setSelected(new Set())}
          />
        </div>
      )}
    </div>
  );
}

function ActiveBlock({ list, selection }: { list: DownloadRecord[]; selection: Selection }) {
  const f = activeProgress(list);
  const moving = list.filter((d) => d.state === "downloading").length;
  return (
    <section className="dk-dl-section" aria-label="In progress">
      <div className="dk-dl-section-head">
        <h2>{moving ? `Downloading ${moving} of ${list.length}` : "In Progress"}</h2>
        {f != null && (
          <span
            className="dk-dl-overall"
            role="progressbar"
            aria-label="Overall progress"
            aria-valuenow={Math.round(f * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ transform: `scaleX(${f})` }} />
          </span>
        )}
      </div>
      <ul className="dk-dl-rows">
        {list.map((d) => (
          <DeskDownloadRow key={d.id} d={d} series={d.type === "series"} watched={false} selection={selection} showTitle />
        ))}
      </ul>
    </section>
  );
}

function DeskTitleGroup({
  title,
  watched,
  open,
  onToggle,
  selection,
}: {
  title: DownloadTitle;
  watched: Set<string>;
  open: string[];
  onToggle: (key: string) => void;
  selection: Selection;
}) {
  const ids = title.items.map((d) => d.id);
  const allLeaving = useAllLeaving(ids);

  if (title.type !== "series") {
    return (
      <section className="dk-dl-group" data-leaving={allLeaving || undefined}>
        <ul className="dk-dl-rows">
          {title.items.map((d) => (
            <DeskDownloadRow key={d.id} d={d} series={false} watched={watched.has(d.id)} selection={selection} movie />
          ))}
        </ul>
      </section>
    );
  }

  const isOpen = open.includes(title.key);
  const bodyId = `dk-dl-title-${title.key}`;
  const multiSeason = title.seasons.length > 1;

  return (
    <section className="dk-dl-group dk-dl-show" data-open={isOpen || undefined} data-leaving={allLeaving || undefined}>
      <div className="dk-dl-show-head">
        {selection && <SelectBox ids={ids} selection={selection} label={`Select all episodes of ${title.name}`} />}
        <button type="button" className="dk-dl-show-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => onToggle(title.key)}>
          <span className="dk-dl-poster">{title.poster ? <Img src={title.poster} alt="" /> : <StillPlaceholder />}</span>
          <span className="dk-dl-show-info">
            <span className="dk-dl-show-name">{title.name}</span>
            <span className="dk-dl-show-sub tabular">
              {[plural(title.items.length, "episode"), formatBytes(title.bytes), title.unwatched ? `${title.unwatched} unwatched` : "All watched"].join(" · ")}
            </span>
          </span>
          <ChevronDown size={18} className="dk-dl-chevron" />
        </button>
        {!selection && <QuietBulkDelete ids={ids} label={`Delete ${title.name}`} iconOnly />}
      </div>

      {isOpen && (
        <div id={bodyId} className="dk-dl-show-body">
          {multiSeason ? (
            title.seasons.map((s) => (
              <div key={s.key} className="dk-dl-season">
                <p className="dk-dl-season-label tabular">
                  {seasonName(s.season)} <span>· {plural(s.items.length, "episode")} · {formatBytes(s.bytes)}</span>
                </p>
                <ul className="dk-dl-rows">
                  {s.items.map((d) => (
                    <DeskDownloadRow key={d.id} d={d} series watched={watched.has(d.id)} selection={selection} />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <ul className="dk-dl-rows">
              {title.items.map((d) => (
                <DeskDownloadRow key={d.id} d={d} series watched={watched.has(d.id)} selection={selection} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function DeskDownloadRow({
  d,
  series,
  watched,
  selection,
  movie = false,
  showTitle = false,
}: {
  d: DownloadRecord;
  series: boolean;
  watched: boolean;
  selection: Selection;
  movie?: boolean;
  showTitle?: boolean;
}) {
  const { navigate } = useNavigation();
  const leaving = useLeaving(d.id);
  const auto = useAutoDownloads().ids.has(d.id);
  const name = series && d.episode != null ? `${d.episode}. ${d.episodeTitle ?? `Episode ${d.episode}`}` : d.name;
  const art = movie ? (d.background ?? d.poster) : (d.thumbnail ?? d.background);
  const selecting = selection !== null;
  const picked = selection?.has(d.id) ?? false;
  const frac = downloadFraction(d);

  const play = () => navigate({ name: "player", type: d.type, metaId: d.metaId, videoId: d.id, stream: localStream(d) });

  return (
    <li className="dk-dl-row" data-state={d.state} data-leaving={leaving || undefined}>
      {selection && <SelectBox ids={[d.id]} selection={selection} label={`Select ${series && showTitle ? `${d.name} ` : ""}${name}`} />}
      <button
        type="button"
        className="dk-dl-row-main"
        disabled={!selecting && d.state !== "done"}
        aria-pressed={selecting ? picked : undefined}
        onClick={() => (selection ? selection.set([d.id], !picked) : play())}
      >
        <span className="dk-dl-still">
          {art ? <Img src={art} alt="" /> : <StillPlaceholder />}
          {d.state === "done" && (
            <span className="dk-dl-play" aria-hidden>
              <IconPlayRing size={32} />
            </span>
          )}
          {d.state !== "done" && frac != null && (
            <span className="dk-dl-bar">
              <i style={{ transform: `scaleX(${frac})` }} />
            </span>
          )}
        </span>
        <span className="dk-dl-row-text">
          {showTitle && series && <span className="dk-dl-row-kicker">{d.name}</span>}
          <span className="dk-dl-row-title">{name}</span>
          <span className="dk-dl-row-sub tabular">
            {watched && (
              <span className="dk-dl-watched">
                <Watched size={13} aria-hidden /> Watched ·{" "}
              </span>
            )}
            {auto && "Auto · "}
            {formatLine(d, movie)}
          </span>
          {d.state === "failed" && d.error && <span className="dk-dl-error">{d.error}</span>}
        </span>
      </button>
      <DownloadButton
        item={{ id: d.metaId, type: d.type, name: d.name, poster: d.poster, background: d.background, logo: d.logo }}
        video={series ? { id: d.id, title: d.episodeTitle ?? "", season: d.season ?? 0, episode: d.episode ?? 0, thumbnail: d.thumbnail } : undefined}
        className="dk-dl-action"
        size={18}
      />
    </li>
  );
}

function SelectBox({ ids, selection, label }: { ids: string[]; selection: NonNullable<Selection>; label: string }) {
  const picked = ids.filter((id) => selection.has(id)).length;
  return (
    <input
      type="checkbox"
      className="dk-dl-check"
      aria-label={label}
      checked={picked === ids.length && ids.length > 0}
      ref={(el) => {
        if (el) el.indeterminate = picked > 0 && picked < ids.length;
      }}
      onChange={(e) => selection.set(ids, e.target.checked)}
    />
  );
}

function QuietBulkDelete({
  ids,
  label,
  disabled = false,
  iconOnly = false,
  onDone,
}: {
  ids: string[];
  label: string;
  disabled?: boolean;
  iconOnly?: boolean;
  onDone?: () => void;
}) {
  const { armed, props } = useConfirmDelete(() => {
    void removeDownloads(ids).then(onDone);
  }, label);
  return (
    <button
      type="button"
      className={iconOnly ? "dk-dl-action dk-dl-trash" : "dk-dl-pill dk-dl-danger"}
      disabled={disabled}
      {...props}
      aria-label={armed ? `Click again: ${label}` : label}
      title={armed ? "Click again to delete" : label}
    >
      <TrashLid size={16} />
      {!iconOnly && <span>{armed ? "Confirm delete" : label}</span>}
    </button>
  );
}
