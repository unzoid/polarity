import { useState } from "react";
import { Dropdown } from "../Dropdown";
import { Button } from "../ui/Button";
import {
  autoKey,
  folderChoice,
  pickDownloadFolder,
  setDownloadFolder,
  useAutoDownloads,
  useBatch,
  useDownloadVolumes,
  type AutoRun,
  type DownloadsStorage,
} from "../../lib/library";
import { episodeCode } from "../../lib/format";
import { errorMessage } from "../../lib/errors";

/**
 * Where new downloads go, under the Downloads page's storage line. Desktop: the folder, Change… (the
 * system's folder dialog) and Use Default once one was chosen. Android: internal storage or an SD
 * card, when one is in. iOS: nothing (the app's own folder, no choice). Downloads already made stay
 * where they are.
 */
export function DownloadFolder({ storage }: { storage: DownloadsStorage | undefined }) {
  const choice = folderChoice();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const volumes = useDownloadVolumes(choice === "volumes").data ?? [];
  if (!storage || choice === "none") return null;

  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    f()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  if (choice === "volumes") {
    if (!volumes.length) return null;
    const current = storage.custom ? storage.dir : "";
    return (
      <div className="downloads-folder-row">
        <span className="t-caption faint">Save new downloads to</span>
        <Dropdown
          label="Download location"
          value={current}
          options={[{ value: "", label: "Internal storage" }, ...volumes.map((v) => ({ value: v.path, label: v.label }))]}
          onChange={(dir) => run(() => setDownloadFolder(dir || null))}
        />
        {error && <p className="t-caption download-row-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="downloads-folder-row">
      <p className="t-caption faint downloads-folder" title={storage.dir}>
        Saved in {storage.dir}
      </p>
      <Button size="sm" disabled={busy} onClick={() => run(pickDownloadFolder)}>
        Change…
      </Button>
      {storage.custom && (
        <Button size="sm" disabled={busy} onClick={() => run(() => setDownloadFolder(null))}>
          Use Default
        </Button>
      )}
      {error && <p className="t-caption download-row-error">{error}</p>}
    </div>
  );
}

/** "Keeping The Lantern Keepers downloaded: S1 E3, S1 E4 · Waiting for Wi-Fi", for each show whose run is going. */
export function AutoDownloadsNote() {
  const { runs } = useAutoDownloads();
  if (!runs.length) return null;
  return (
    <ul className="downloads-auto" aria-label="Keeping the next episodes downloaded">
      {runs.map((r) => (
        <AutoRunLine key={r.showId} run={r} />
      ))}
    </ul>
  );
}

function AutoRunLine({ run }: { run: AutoRun }) {
  const batch = useBatch(autoKey(run.showId));
  const codes = run.videos.map((v) => episodeCode(v.season, v.episode)).join(", ");
  const status = batch?.held?.reason;
  return (
    <li className="t-caption faint">
      {[`Keeping ${run.name} downloaded: ${codes}`, status].filter(Boolean).join(" · ")}
    </li>
  );
}
