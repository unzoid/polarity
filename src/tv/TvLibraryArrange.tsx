import { useState } from "react";
import { TvRail } from "./TvRails";
import {
  KIND_OPTIONS,
  readLibraryView,
  saveLibraryView,
  SORT_LABELS,
  sortsOf,
  STATUS_LABELS,
  statusesOf,
  type LibraryView,
} from "../lib/library";

/**
 * TV's Library: type, status and sort for the Saved and Watched rails, as pills that step through their
 * choices on each press (the D-pad has no dropdowns). Remembered on this device, apart from desktop's
 * per-collection views. Genre, year and search are left to desktop's collection pages.
 */
export function useTvLibraryView() {
  const [view, setView] = useState<LibraryView>(() => readLibraryView("saved", undefined, "tv"));
  const update = (patch: Partial<LibraryView>) =>
    setView((v) => {
      const next = { ...v, ...patch };
      saveLibraryView("tv", next);
      return next;
    });
  return [view, update] as const;
}

const next = <T,>(list: readonly T[], current: T) => list[(list.indexOf(current) + 1) % list.length];

export function TvArrangeRail({
  view,
  onChange,
  nothing,
}: {
  view: LibraryView;
  onChange: (patch: Partial<LibraryView>) => void;
  /** The filters hide every saved and watched title. */
  nothing: boolean;
}) {
  const kinds = KIND_OPTIONS.map((o) => o.value);
  const statuses = statusesOf("saved");
  const sorts = sortsOf("saved");
  const filtered = view.kind !== "all" || view.status !== "any";
  return (
    <TvRail title="Arrange" note={nothing ? "Nothing saved or watched matches these filters" : undefined}>
      <button className="tv-pill tv-arrange-pill" onClick={() => onChange({ kind: next(kinds, view.kind) })}>
        Show: {KIND_OPTIONS.find((o) => o.value === view.kind)!.label}
      </button>
      <button className="tv-pill tv-arrange-pill" onClick={() => onChange({ status: next(statuses, view.status) })}>
        Status: {STATUS_LABELS[view.status]}
      </button>
      <button className="tv-pill tv-arrange-pill" onClick={() => onChange({ sort: next(sorts, view.sort) })}>
        Sort: {SORT_LABELS[view.sort]}
      </button>
      {filtered && (
        <button className="tv-pill tv-arrange-pill" onClick={() => onChange({ kind: "all", status: "any" })}>
          Clear Filters
        </button>
      )}
    </TvRail>
  );
}
