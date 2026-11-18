import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Dropdown } from "../Dropdown";
import { EmptyState } from "../ui/EmptyState";
import { SearchField } from "../ui/SearchField";
import {
  activeParts,
  arrangeLibrary,
  decadeOptions,
  genreOptions,
  hidingParts,
  KIND_OPTIONS,
  needsFacts,
  readLibraryView,
  saveLibraryView,
  SORT_LABELS,
  sortsOf,
  STATUS_LABELS,
  statusesOf,
  type FilterPart,
  type KindFilter,
  type LibraryCollectionName,
  type LibraryEntry,
  type LibraryFilters,
  type LibrarySort,
  type LibraryView,
  type StatusFilter,
} from "../../lib/library";

const ANY = "*";
const decadeLabel = (d: number) => `${d}s`;
const titles = (n: number) => `${n} title${n === 1 ? "" : "s"}`;

/** "A, B and C". */
const listed = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

function partLabel(part: FilterPart, f: LibraryFilters): string {
  switch (part) {
    case "kind":
      return KIND_OPTIONS.find((o) => o.value === f.kind)!.label;
    case "status":
      return STATUS_LABELS[f.status];
    case "genre":
      return f.genre;
    case "decade":
      return decadeLabel(f.decade);
    case "query":
      return `“${f.query.trim()}”`;
  }
}

/**
 * Saved or Watched in full, with a search field, filters that combine (type, status, genre, decade) and
 * sorts, remembered per collection on this device. The count and Clear Filters sit under them; when
 * nothing is left the note names the filters that hide everything. Logic in `lib/library/libraryView.ts`.
 */
export function FilteredCollection<T>({
  collection,
  title,
  entries,
  children,
}: {
  collection: LibraryCollectionName;
  /** The collection's name, for the empty note ("Nothing in Saved matches …"). */
  title: string;
  entries: LibraryEntry<T>[] | undefined;
  children: (items: T[] | undefined) => ReactNode;
}) {
  const [view, setView] = useState<LibraryView>(() => readLibraryView(collection));
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const update = (patch: Partial<LibraryView>) =>
    setView((v) => {
      const next = { ...v, ...patch };
      saveLibraryView(collection, next);
      return next;
    });
  const filters: LibraryFilters = useMemo(() => ({ ...view, query: deferred }), [view, deferred]);
  const arranged = useMemo(() => entries && arrangeLibrary(entries, filters), [entries, filters]);
  const genres = useMemo(() => genreOptions(entries ?? [], view.genre), [entries, view.genre]);
  const decades = useMemo(() => decadeOptions(entries ?? [], view.decade), [entries, view.decade]);
  const active = activeParts(filters);
  const clear = () => {
    setQuery("");
    update({ kind: "all", status: "any", genre: "", decade: 0 });
  };

  const looking = arranged && arranged.undecided > 0 && (needsFacts(view) || !!filters.query.trim());
  const empty = entries && arranged && entries.length > 0 && arranged.items.length === 0;

  return (
    <>
      <div className="library-filters" role="search" aria-label={`Search and filter ${title}`}>
        <SearchField look="pill" className="library-search" label={`Search ${title}`} placeholder="Search" value={query} onChange={setQuery} />
        <Dropdown<KindFilter> label="Show" value={view.kind} onChange={(kind) => update({ kind })} options={KIND_OPTIONS} />
        <Dropdown<StatusFilter>
          label="Status"
          value={view.status}
          onChange={(status) => update({ status })}
          options={statusesOf(collection).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        {genres.length > 0 && (
          <Dropdown
            label="Genre"
            value={view.genre || ANY}
            onChange={(g) => update({ genre: g === ANY ? "" : g })}
            options={[{ value: ANY, label: "All Genres" }, ...genres.map((g) => ({ value: g, label: g }))]}
          />
        )}
        {decades.length > 0 && (
          <Dropdown
            label="Year"
            value={view.decade ? String(view.decade) : ANY}
            onChange={(d) => update({ decade: d === ANY ? 0 : Number(d) })}
            options={[{ value: ANY, label: "Any Year" }, ...decades.map((d) => ({ value: String(d), label: decadeLabel(d) }))]}
          />
        )}
        <Dropdown<LibrarySort>
          label="Sort by"
          value={view.sort}
          onChange={(sort) => update({ sort })}
          options={sortsOf(collection).map((s) => ({ value: s, label: SORT_LABELS[s] }))}
        />
      </div>
      {entries && arranged && entries.length > 0 && (
        <p className="library-filter-summary t-footnote muted" aria-live="polite">
          {active.length ? `${arranged.items.length} of ${titles(entries.length)}` : titles(entries.length)}
          {looking && ` · Still looking up ${titles(arranged.undecided)}, shown until their details are in`}
          {active.length > 0 && (
            <>
              {" · "}
              <button className="settings-link" onClick={clear}>
                Clear Filters
              </button>
            </>
          )}
        </p>
      )}
      {empty ? (
        <EmptyState action={{ label: "Clear Filters", onClick: clear }}>
          Nothing in {title} matches {listed(hidingParts(entries, filters).map((p) => partLabel(p, filters)))}.
        </EmptyState>
      ) : (
        children(arranged?.items)
      )}
    </>
  );
}
