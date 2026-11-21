import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "../components/icons";
import { ANIME_SHELVES, setShelfVisible, useShelfVisible } from "../lib/anime";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { keys, useAddons } from "../lib/net";
import { os, torrentsPlayHere } from "../lib/platform";
import { usePrefs } from "../lib/settings";
import { choicesOf, numberLabel, shownNumber, storedNumber, tvNumberSteps, useSetting } from "../lib/settings/catalog";
import { useLimitFromProfile, useViewingLimit } from "../lib/catalog";
import { limitLabel, SET_IN_PROFILE } from "../components/profileLock/LimitFromProfile";
import { useBack, usePageActive } from "./shell";
import { playSound } from "./sounds";
import { focusWhenReady } from "./spatial";
import { TvKeyboard } from "./TvKeyboard";

/**
 * Settings in TV mode: the ones you'd change from the couch, grouped into
 * categories, each setting a row you change with left and right (or Enter to step through). No text fields, so
 * no on-screen keyboard; keys, add-ons and the rest stay in desktop mode.
 */

type Choice<T> = { value: T; label: string };

const onOff: Choice<boolean>[] = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

type CategoryId = "playback" | "sources" | "addons" | "browsing" | "anime" | "tv";

const CATEGORIES: { id: CategoryId; title: string; caption: string }[] = [
  { id: "playback", title: "Playback", caption: "Autoplay, skip intro, languages, crop mode, and audio output." },
  { id: "sources", title: "Sources", caption: "Automatic source selection, resolution caps, and sorting." },
  { id: "addons", title: "Add-ons", caption: "Enable, disable, install, or remove third-party add-ons without leaving TV mode." },
  { id: "browsing", title: "Browsing", caption: "Trailers, ratings, viewing limits, calendar, and Continue Watching." },
  { id: "anime", title: "Anime", caption: "Title language, AniList scores, filler skipping, and shelves." },
  { id: "tv", title: "Remote and Controller", caption: "Interface sounds, controller button glyphs, and stick navigation." },
];

/** A list of categories; Enter opens one, Back returns to the list on the one you left. `page` opens one at the start. */
export function TvSettings({ page }: { page?: string }) {
  const active = usePageActive();
  const asked = CATEGORIES.find((c) => c.id === page)?.id ?? null;
  const [open, setOpen] = useState<CategoryId | null>(asked);
  const [focused, setFocused] = useState<CategoryId>(asked ?? "playback");
  const [help, setHelp] = useState<string | undefined>(CATEGORIES.find((c) => c.id === (asked ?? "playback"))?.caption);
  const listRef = useRef<HTMLDivElement>(null);

  const go = (next: CategoryId | null) => {
    setOpen(next);
    setHelp(next ? CATEGORIES.find((c) => c.id === next)?.caption : CATEGORIES.find((c) => c.id === focused)?.caption);
    // The row you pressed is gone: land in the new list once it's in.
    requestAnimationFrame(() => focusWhenReady(listRef.current));
  };
  useBack(active && !!open, () => go(null));

  const category = open ? CATEGORIES.find((c) => c.id === open)! : null;

  return (
    <div className="tv-settings">
      <div className="tv-settings-list" ref={listRef} key={open ?? "root"} data-nav-scroll>
        {category ? (
          <>
            <p className="tv-settings-eyebrow">Settings</p>
            <h1 className="tv-heading">{category.title}</h1>
            <CategoryRows id={category.id} active={active} onHelp={setHelp} />
          </>
        ) : (
          <>
            <h1 className="tv-heading">Settings</h1>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="tv-settings-row"
                data-nav-default={c.id === focused || undefined}
                onFocus={() => {
                  setFocused(c.id);
                  setHelp(c.caption);
                }}
                onClick={() => go(c.id)}
              >
                <span className="tv-settings-label">{c.title}</span>
                <ChevronRight size={18} className="tv-settings-chevron" />
              </button>
            ))}
          </>
        )}
      </div>
      {help && (
        <p className="tv-settings-help" role="status" aria-live="polite">
          {help}
        </p>
      )}
    </div>
  );
}

/** Each category's settings, by schema id (lib/settings/schema.ts); the first row takes focus. */
const ROWS: Record<Exclude<CategoryId, "anime" | "addons">, string[]> = {
  playback: [
    "autoplayNext",
    "autoplayCountdown",
    "stillWatchingAfter",
    "autoSkip",
    "autoSkipDelay",
    "cropMode",
    "resumePlayback",
    "seekStep",
    "pauseShowsControls",
    "pauseDetails",
    "showPlayingFormat",
    "audioLanguage",
    "subtitleLanguage",
    "preferSdh",
    // A TV is where a receiver or soundbar sits.
    "maxVolume",
    ...(os === "ios" ? [] : ["passthrough"]),
  ],
  sources: [
    "autoPickSource",
    "maxResolution",
    "preferScreenResolution",
    "hideCam",
    "sourceSort",
    "sourceFiltersHide",
    // Where the built-in engine plays them (#207), so a TV reaches them in TV mode too.
    ...(torrentsPlayHere ? ["torrentUploadMbps", "torrentCacheGb", "torrentKeepSharing"] : []),
    ...(os === "android" ? ["torrentMobileData"] : []),
  ],
  browsing: ["trailerAutoplay", "trailerSound", "showCardRatings", "cardRatingPosition", "viewingLimit", "viewingHideUnrated", "matureContent", "showCalendar", "showContinueWatching", "hideWatched"],
  tv: [
    "uiSounds",
    "uiSoundPack",
    "uiSoundVolume",
    "padLabels",
    "padHints",
    "padStick",
    "padStickSensitivity",
    "padRepeat",
    "padPlayerVolume",
    "controllerAlerts",
  ],
};

const ANIME_ROWS = ["animeTitles", "animeAudioLanguage", "animeSubtitleLanguage", "animeCardScores", "animeScoreFormat", "animeCardCountdown", "animeSeparateEntries"];

function CategoryRows({ id, active, onHelp }: { id: CategoryId; active: boolean; onHelp: (text: string | undefined) => void }) {
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();

  if (id === "addons") return <TvAddonsRows active={active} onHelp={onHelp} />;
  if (id !== "anime") return ROWS[id].map((setting, i) => <SettingRow key={setting} id={setting} first={i === 0} onHelp={onHelp} />);
  return (
    <>
      <SettingRow id="animeEnabled" first onHelp={onHelp} />
      {prefs.animeEnabled && (
        <>
          {ANIME_ROWS.map((setting) => (
            <SettingRow key={setting} id={setting} onHelp={onHelp} />
          ))}
          {ANIME_SHELVES.filter((s) => s.id !== "hero").map((s) => (
            <Row
              key={s.id}
              label={s.label}
              choices={onOff}
              value={shelfVisible(s.id)}
              onChange={(v) => setShelfVisible(s.id, v)}
              onFocus={() => onHelp(`Show the ${s.label} shelf on the Anime tab.`)}
            />
          ))}
        </>
      )}
    </>
  );
}

/** TV-native add-on management: enable/disable, remove, or install a manifest URL right from the couch. */
function TvAddonsRows({ active, onHelp }: { active: boolean; onHelp: (text: string | undefined) => void }) {
  const qc = useQueryClient();
  const { data: addons = [] } = useAddons();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.addons }),
      qc.invalidateQueries({ queryKey: keys.streamsAll }),
      qc.invalidateQueries({ queryKey: ["subtitles"] }),
      qc.invalidateQueries({ queryKey: keys.addonCatalogAll }),
    ]);

  const install = useMutation({
    mutationFn: api.installAddon,
    onSuccess: () => {
      setUrl("");
      setAdding(false);
      setError(null);
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setAddonEnabled(id, on),
    onSuccess: () => void refresh(),
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: api.removeAddon,
    onSuccess: () => {
      setArmedRemove(null);
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed || install.isPending) return;
    setError(null);
    install.mutate(trimmed);
  };

  return (
    <>
      <button
        className="tv-settings-row"
        data-nav-default={addons.length === 0 || undefined}
        onFocus={() => onHelp("Install a third-party add-on by entering its manifest URL.")}
        onClick={() => {
          setAdding((a) => !a);
          setError(null);
        }}
      >
        <span className="tv-settings-label">{adding ? "Hide Add-on URL Keyboard" : "Install Add-on by URL"}</span>
        <ChevronRight size={18} className="tv-settings-chevron" />
      </button>
      {adding && (
        <div className="tv-addons-install">
          <TvKeyboard
            text={url}
            onChange={setUrl}
            onSubmit={submit}
            placeholder="https://addon.example.com/manifest.json"
            active={active}
            max={300}
            url
          />
          <button
            className="tv-settings-row"
            disabled={!url.trim() || install.isPending}
            onClick={submit}
            onFocus={() => onHelp("Fetch the manifest and install this add-on.")}
          >
            <span className="tv-settings-label">{install.isPending ? "Installing…" : "Install Add-on"}</span>
          </button>
        </div>
      )}
      {error && (
        <p className="tv-settings-error" role="alert">
          {error}
        </p>
      )}
      {addons.length === 0 ? (
        <p className="tv-settings-empty">No add-ons installed yet. Choose “Install Add-on by URL” above to add one.</p>
      ) : (
        addons.map((a, i) => {
          const enabled = !a.disabled;
          const armed = armedRemove === a.manifest.id;
          return (
            <div key={a.manifest.id} className="tv-addon-group">
              <Row
                label={a.manifest.name}
                choices={onOff}
                value={enabled}
                first={i === 0}
                onChange={(on) => toggle.mutate({ id: a.manifest.id, on })}
                onFocus={() =>
                  onHelp(a.manifest.description ? `v${a.manifest.version} · ${a.manifest.description}` : `Version ${a.manifest.version}`)
                }
              />
              <button
                className="tv-settings-row tv-settings-row-sub"
                onFocus={() => onHelp(`Remove ${a.manifest.name} from this device.`)}
                onBlur={() => armed && setArmedRemove(null)}
                onClick={() => {
                  if (!armed) return setArmedRemove(a.manifest.id);
                  remove.mutate(a.manifest.id);
                }}
              >
                <span className="tv-settings-label">{armed ? `Confirm remove ${a.manifest.name}?` : `Remove ${a.manifest.name}`}</span>
              </button>
            </div>
          );
        })
      )}
    </>
  );
}

/** A schema setting as a TV row: its TV label, and its choices or the number steps to move through. */
function SettingRow({ id, first, onHelp }: { id: string; first?: boolean; onHelp: (text: string | undefined) => void }) {
  const { def, value, set } = useSetting(id);
  const fromProfile = useLimitFromProfile();
  const viewing = useViewingLimit();
  const control = def.control;
  if (value === undefined || !control) return null;
  const label = def.tv ?? def.title;
  const caption = def.caption;
  // A restricted profile's limit is its own (set in its edit sheet behind a PIN): shown, not changed here.
  if (fromProfile && (id === "viewingLimit" || id === "viewingHideUnrated")) {
    const shown = id === "viewingLimit" ? limitLabel(viewing.limit) : viewing.hideUnrated ? "On" : "Off";
    return (
      <button
        className="tv-settings-row"
        data-nav-default={first || undefined}
        onFocus={() => onHelp(caption ?? SET_IN_PROFILE)}
        aria-label={`${label}: ${shown}. ${SET_IN_PROFILE}`}
      >
        <span className="tv-settings-label">{label}</span>
        <span className="tv-settings-value">
          <span>
            {shown} · {SET_IN_PROFILE}
          </span>
        </span>
      </button>
    );
  }

  switch (control.kind) {
    case "toggle":
      return <Row label={label} choices={onOff} value={!!value} onChange={set} first={first} onFocus={() => onHelp(caption)} />;
    case "choice":
      return <Row label={label} choices={choicesOf(control, value)} value={value} onChange={set} first={first} onFocus={() => onHelp(caption)} />;
    case "number": {
      const shown = shownNumber(control, Number(value));
      const choices = tvNumberSteps(control, shown).map((n) => ({ value: n, label: numberLabel(control, n) }));
      return <Row label={label} choices={choices} value={shown} onChange={(n) => set(storedNumber(control, n))} first={first} onFocus={() => onHelp(caption)} />;
    }
  }
}

function Row<T>({
  label,
  choices,
  value,
  onChange,
  first,
  onFocus,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  first?: boolean;
  onFocus?: () => void;
}) {
  const found = choices.findIndex((c) => c.value === value);
  const i = found < 0 ? 0 : found;
  const current = found < 0 ? String(value) : choices[i].label;
  const isToggle = choices === onOff;

  const step = (by: number, wrap: boolean) => {
    let j = i + by;
    if (wrap) j = (j + choices.length) % choices.length;
    if (j < 0 || j >= choices.length) {
      playSound("edge");
      return;
    }
    onChange(choices[j].value);
    playSound("move");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      step(e.key === "ArrowLeft" ? -1 : 1, isToggle);
    }
  };

  return (
    <button
      className="tv-settings-row"
      data-nav-default={first || undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={() => step(1, true)}
      aria-label={`${label}: ${current}`}
    >
      <span className="tv-settings-label">{label}</span>
      <span className="tv-settings-value" data-on={isToggle ? (value as boolean) : undefined}>
        <ChevronLeft size={22} data-dim={!isToggle && i === 0} />
        <span>{current}</span>
        <ChevronRight size={22} data-dim={!isToggle && i === choices.length - 1} />
      </span>
    </button>
  );
}
