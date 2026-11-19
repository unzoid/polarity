import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { sync } from "../../lib/account";
import { errorMessage } from "../../lib/errors";
import {
  describeImport,
  exportablePlaylists,
  importPlaylists,
  importPolarityExport,
  readPolarityExport,
  usePlaylists,
} from "../../lib/library";
import { keys } from "../../lib/net";
import { isDesktop } from "../../lib/platform";
import { ActionRow, Card, RowText } from "./rows";

/**
 * Settings → "Export library and history" and "Import a Polarity export": the profile's library,
 * history, anime links and playlists as a file to keep or move to another device or profile
 * (lib/library/polarityExport.ts; written by src-tauri/src/library_export.rs), and that file read
 * back. Saving needs the system's save dialog, so export is on desktop only for now.
 */
export function PolarityExport() {
  const qc = useQueryClient();
  const playlists = usePlaylists();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"json" | "csv" | "import" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = (what: "json" | "csv" | "import") => {
    setBusy(what);
    setDone(null);
    setError(null);
  };

  const exportAs = async (format: "json" | "csv") => {
    start(format);
    try {
      const name = await api.exportLibrary(format, exportablePlaylists(playlists));
      if (name) setDone(`Saved ${name}.`);
    } catch (e) {
      setError(`Export failed: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (list: FileList | null) => {
    const picked = list?.[0];
    if (!picked) return;
    start("import");
    try {
      const doc = readPolarityExport(await picked.text());
      const added = await importPolarityExport(doc, {
        importAnimeLinks: api.importAnimeLinks,
        importLibrary: api.importLibrary,
        importPlaylists,
      });
      for (const key of [keys.library, keys.progressAll, keys.continue, keys.history]) qc.invalidateQueries({ queryKey: key });
      sync.schedule();
      setDone(`${picked.name}: ${describeImport(added, doc.unreadable)}`);
    } catch (e) {
      setError(`${picked.name}: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Export library and history"
      footer="Your library, every episode and film you've watched or started, anime links and playlists. Sources you played, add-ons and keys aren't in the file. Importing a Polarity export adds what isn't here; anything newer here stays, and importing the same file again adds nothing."
    >
      {isDesktop && (
        <>
          <ActionRow
            setting="polarityExport"
            title="Polarity export"
            caption="A .json file this or another device can import"
            label="Export…"
            disabled={busy != null}
            pending={busy === "json"}
            pendingLabel="Exporting…"
            onClick={() => void exportAs("json")}
          />
          <ActionRow
            title="Watch history as CSV"
            caption="Title, type, season, episode, episode title, watched on and progress, for a spreadsheet"
            label="Export…"
            disabled={busy != null}
            pending={busy === "csv"}
            pendingLabel="Exporting…"
            onClick={() => void exportAs("csv")}
          />
        </>
      )}
      <ActionRow
        setting="polarityImport"
        title="Import a Polarity export"
        caption="The .json file from Export library and history"
        label="Choose File…"
        disabled={busy != null}
        pending={busy === "import"}
        pendingLabel="Importing…"
        onClick={() => file.current?.click()}
      />
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Polarity export file"
        onChange={(e) => {
          void importFile(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="settings-error settings-card-pad">{error}</p>}
      {done && (
        <div className="settings-row" role="status">
          <RowText title="Done" caption={done} />
        </div>
      )}
    </Card>
  );
}
