import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Reset, Download, Feedback, Info, Lock, Trash } from "../../components/icons";
import { FEEDBACK_EMAIL, FEEDBACK_KINDS, feedbackContext, feedbackUrl } from "../../lib/feedback";
import { api } from "../../lib/api";
import tmdbLogo from "../../assets/tmdb-short.svg";
import { CREDITS, PRIVACY_URL, TERMS_URL, TMDB_NOTICE } from "../../lib/settings";
import { ReleaseNotes } from "../../components/Updates";
import {
  appVersion,
  checkForUpdates,
  devBuilds,
  downloadUpdate,
  installDevBuild,
  installUpdate,
  releaseUrl,
  setDevUpdatesPaused,
  useDevUpdatesPaused,
  useUpdate,
} from "../../lib/updater";
import { Button } from "../../components/ui/Button";
import { ActionRow, Card, ExpandRow, LinkRow, PickRow, RowText, ToggleRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { cachedBytes, clearCached, keys } from "../../lib/net";
import { appName, appUpdates, buildChannel, buildCommit, buildLabel } from "../../lib/platform";
import { errorMessage } from "../../lib/errors";
import { forgetTracks, rememberedSources } from "../../lib/playback";

/** Where this build's updates come from (lib/platform/build.ts, docs/dev-channel.md). */
const FOOTER = {
  release: "Updates are signed and come straight from Polarity's GitHub releases. Your library, settings and profiles are kept.",
  dev: "A development build: it updates from Polarity's \u201cDev build\u201d pre-release only, never to or from a release. Your library, settings and profiles are kept.",
  local: "Built on this computer, so it doesn't look for updates. Install a release or dev build to get them.",
} as const;

export function AboutPage() {
  const s = useUpdate();
  const expand = useExpanded();
  const { data: version } = useQuery({ queryKey: keys.appVersion, queryFn: appVersion, staleTime: Infinity });
  const paused = useDevUpdatesPaused();
  const updates = buildChannel !== "local";
  const dev = buildChannel === "dev" && appUpdates.canUpdate;

  const status = (() => {
    switch (s.phase) {
      case "checking":
        return "Checking…";
      case "current":
        return "You're on the latest version";
      case "available":
        return `${s.name} is available`;
      case "downloading":
        return `Downloading ${s.name}${s.progress == null ? "…" : ` · ${Math.round(s.progress * 100)}%`}`;
      case "ready":
        return `${s.name} is downloaded. Restart to finish.`;
      case "installing":
        return `Installing ${s.name}…`;
      case "error":
        return s.message;
      default:
        return "Checks automatically every few hours";
    }
  })();

  return (
    <>
      <Card title={appName} footer={FOOTER[buildChannel]}>
        <PickRow title="Version" caption={updates ? status : "Doesn't check for updates"}>
          <span className="settings-row-value settings-version">{version ? buildLabel(buildChannel, version) : "…"}</span>
        </PickRow>
        {buildChannel === "release" && (
          <PickRow title="Commit" caption="The last commit this build is from">
            <span className="settings-row-value settings-version">{buildCommit}</span>
          </PickRow>
        )}
        {updates && (
          <div className="settings-row">
            <RowText title="Software update" caption={s.phase === "ready" ? "Takes a few seconds; Polarity reopens by itself" : undefined} />
            <div className="settings-expand-actions">
              {s.phase === "available" ? (
                <Button variant="primary" onClick={() => void downloadUpdate()}>
                  <Download size={15} /> Download {s.version}
                </Button>
              ) : s.phase === "ready" ? (
                <Button variant="primary" onClick={() => void installUpdate()}>
                  <Reset size={15} /> Restart to Update
                </Button>
              ) : (
                <Button
                  disabled={s.phase === "checking" || s.phase === "downloading" || s.phase === "installing"}
                  onClick={() => void checkForUpdates()}
                >
                  Check for Updates
                </Button>
              )}
            </div>
          </div>
        )}
        {updates && (
          <SettingRow
            id="autoDownloadUpdates"
            onChanged={(v) => {
              if (v && s.phase === "available") void downloadUpdate();
            }}
          />
        )}
        {dev && (
          <ToggleRow
            title="Pause updates"
            caption="No newer dev build is offered on its own while this is on; Check for Updates still looks"
            checked={paused}
            onChange={setDevUpdatesPaused}
          />
        )}
        {"notes" in s && s.notes && (
          <ExpandRow icon={Info} title={`What's new in ${s.version}`} {...expand("notes")}>
            <div className="whats-new">
              <ReleaseNotes text={s.notes} />
            </div>
          </ExpandRow>
        )}
        {dev && <DevBuildsRow current={version} {...expand("builds")} />}
        <LinkRow
          icon={Info}
          title={dev ? "Dev build notes" : "Release notes"}
          caption={dev ? "The kept builds and the pull requests they came from" : "Every version and what changed"}
          onClick={() => void api.openExternal(releaseUrl())}
        />
      </Card>
      <FeedbackCard version={version} />
      <CacheCard />
      <CreditsCard />
    </>
  );
}

/**
 * Going back (dev builds only): the builds the "Dev build" entry keeps, newest first, each with
 * "Install this build". An older one downloads like an update and waits for Restart to Update;
 * after that the newest is offered again unless updates are paused.
 */
function DevBuildsRow({ current, ...props }: Expandable & { current?: string }) {
  const s = useUpdate();
  const { data, error, isPending } = useQuery({ queryKey: keys.devBuilds, queryFn: devBuilds, enabled: props.open, staleTime: 60_000 });
  const busy = s.phase === "downloading" || s.phase === "installing";
  return (
    <ExpandRow icon={Reset} title="Earlier builds" caption="This dev build and the previous ones kept, to go back to" {...props}>
      {isPending ? (
        <p className="settings-expand-text">Loading the kept builds…</p>
      ) : error ? (
        <p className="settings-error">{errorMessage(error)}</p>
      ) : (
        <ul className="settings-credits">
          {data.map((b) => (
            <li key={b.build}>
              <span className="settings-credit-name">{buildLabel("dev", b.version, b.commit)}</span>
              <span className="settings-expand-text">{[b.date.slice(0, 10), b.title].filter(Boolean).join(" · ")}</span>
              {b.version === current ? (
                <span className="settings-expand-text">This build</span>
              ) : (
                <span className="settings-expand-actions">
                  <Button disabled={busy} onClick={() => void installDevBuild(b.build)}>
                    <Download size={15} /> Install this build
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ExpandRow>
  );
}

/**
 * Send Feedback (#205): each kind opens its issue form in the browser, filled in with this device's system,
 * interface and version. Nothing is sent from here; people without a GitHub account are given the email address.
 */
function FeedbackCard({ version }: { version?: string }) {
  return (
    <Card title="Send Feedback" footer={`No GitHub account? Write to ${FEEDBACK_EMAIL}. Nothing is sent from Polarity by itself.`}>
      {FEEDBACK_KINDS.map((k) => (
        <LinkRow key={k.id} icon={Feedback} title={k.label} caption={k.caption} onClick={() => void api.openExternal(feedbackUrl(k.id, feedbackContext(version)))} />
      ))}
    </Card>
  );
}

/**
 * Where the data comes from, and the privacy policy and terms (#157). TMDB's notice and logo are required to be shown,
 * so they aren't folded away; its rules keep the logo smaller than Polarity's own
 * (the 38px navbar mark) and without any hint of endorsement.
 */
function CreditsCard() {
  const expand = useExpanded();
  return (
    <Card
      title="Credits"
      footer={
        // The notice, then TMDB's logo 12px under it, as one block of their own (test report 1, item 26).
        <span className="settings-credits-tmdb-block">
          {TMDB_NOTICE}
          <img className="settings-credits-tmdb" src={tmdbLogo} alt="TMDB" draggable={false} />
        </span>
      }
    >
      <ExpandRow icon={Info} title="Data sources" caption="Where titles, episodes, ratings and subtitles come from" {...expand("credits")}>
        <ul className="settings-credits">
          {CREDITS.map((c) => (
            <li key={c.name}>
              {c.url ? (
                <button className="settings-credit-name" onClick={() => void api.openExternal(c.url!)}>
                  {c.name}
                </button>
              ) : (
                <span className="settings-credit-name">{c.name}</span>
              )}
              <span className="settings-expand-text">{c.use}</span>
            </li>
          ))}
        </ul>
      </ExpandRow>
      <LinkRow icon={Lock} title="Privacy Policy" caption="What Polarity stores, where, and how to delete it" onClick={() => void api.openExternal(PRIVACY_URL)} />
      <LinkRow icon={Info} title="Terms of Use" onClick={() => void api.openExternal(TERMS_URL)} />
    </Card>
  );
}

/** What the app keeps in its cache folder, and a way to empty it. */
function CacheCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: keys.animeCache, queryFn: api.animeCache });
  // AniList's rows and pages, kept in this device's storage rather than the cache folder (#109).
  const [kept, setKept] = useState(cachedBytes);
  const clear = useMutation({
    mutationFn: async () => {
      clearCached();
      setKept(0);
      await api.animeCacheClear();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.animeCache });
      void qc.removeQueries({ queryKey: keys.anime.episodeFlagsAll });
    },
  });
  const bytes = data && data.bytes + kept;
  const size = bytes === undefined ? "…" : !bytes ? "empty" : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return (
    <Card title="Cache" footer={data ? <>Anime data is kept in {data.path}</> : undefined}>
      <ActionRow
        title="Anime data"
        caption={`AniList's shelves and pages, kept up to a day; filler and recap episodes, kept a day; the anime id list used when ani.zip is down, kept a week · ${size}`}
        label="Clear"
        glyph={<Trash size={15} />}
        disabled={!bytes}
        pending={clear.isPending}
        onClick={() => clear.mutate()}
      />
      <TracksRow />
    </Card>
  );
}

/** The audio, subtitles and subtitle delay picked for each source (#418), kept on this device. */
function TracksRow() {
  const [sources, setSources] = useState(rememberedSources);
  return (
    <ActionRow
      title="Picked tracks"
      caption={`The audio, subtitles and subtitle delay you picked for each source, chosen again when it plays again; the 500 most recent · ${
        sources === 1 ? "1 source" : sources ? `${sources} sources` : "empty"
      }`}
      label="Clear"
      glyph={<Trash size={15} />}
      disabled={!sources}
      onClick={() => {
        forgetTracks();
        setSources(0);
      }}
    />
  );
}
