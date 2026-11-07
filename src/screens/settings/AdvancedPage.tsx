import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Reset } from "../../components/icons";
import { api } from "../../lib/api";
import { keys } from "../../lib/net";
import { resetPrefs, settingDef, usePrefs } from "../../lib/settings";
import { lookaheadCaption } from "../../lib/playback";
import { Button } from "../../components/ui/Button";
import { errorMessage } from "../../lib/errors";
import { ActionRow, Card, ExpandRow, FormRow, PickRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { appUpdates, buildChannel, isDesktop, os } from "../../lib/platform";
import { databaseHost, devDatabase, removeDevDatabase, saveDevDatabase, useAccount } from "../../lib/account";
import { LetterboxdImport } from "../../components/settings/LetterboxdImport";
import { StremioImport } from "../../components/settings/StremioImport";

export function AdvancedPage() {
  const expand = useExpanded();
  const { autocrop, autocropLookahead } = usePrefs();
  const { data: hasMpv } = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  // What the lookahead does in the video playing now, kept current while this page is open.
  const { data: lookahead = null } = useQuery({
    queryKey: keys.mpvLookahead,
    queryFn: api.mpvLookahead,
    enabled: hasMpv === true && autocrop && autocropLookahead,
    refetchInterval: 3000,
  });
  const account = useAccount();
  return (
    <>
      <Card
        title="Video"
        footer={hasMpv === false ? "These need mpv." : "Saved on this device. Changes apply straight away, even mid-video."}
      >
        <SettingRow id="hwdec" disabled={hasMpv === false} />
        <SettingRow id="deband" disabled={hasMpv === false} />
        <SettingRow id="autocrop" disabled={hasMpv === false} />
        <SettingRow
          id="autocropLookahead"
          caption={lookaheadCaption(settingDef("autocropLookahead").caption ?? "", autocrop && autocropLookahead ? lookahead : null)}
          disabled={hasMpv === false || !autocrop}
        />
        {/* macOS and iOS read every frame anyway, in memory. */}
        {os !== "macos" && os !== "ios" && <SettingRow id="autocropEveryFrame" disabled={hasMpv === false || !autocrop} />}
        <SettingRow id="buffer" />
      </Card>
      {buildChannel === "dev" && <DatabaseCard />}
      {/* Signed in, it's under Account. */}
      {!account.profile && <StremioImport />}
      {!account.profile && <LetterboxdImport />}
      <Card title="Reset">
        <ResetRow {...expand("reset")} />
      </Card>
    </>
  );
}

/**
 * Dev builds only (lib/account/devDatabase.ts): which database this build is on, and connecting
 * one from a connection code the team shares privately. Takes effect at the next start.
 */
function DatabaseCard() {
  const db = devDatabase();
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Saved or removed in this run: the switch happens on restart.
  const [changed, setChanged] = useState<"connected" | "removed" | null>(null);
  const run = async (step: () => Promise<string | null | void>, done: "connected" | "removed") => {
    setBusy(true);
    try {
      const why = await step();
      setProblem(why || null);
      if (!why) setChanged(done);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Database"
      footer="Dev builds have no database built in, so they work signed out. Someone on the team can share a connection code privately; it's kept in this device's keychain."
    >
      <PickRow
        title={db ? "Connected to" : "Not connected"}
        caption={db ? "Sign-in, profiles and sync use this database" : "Signed out only: nothing leaves this device"}
      >
        {db && <span className="settings-row-value">{databaseHost(db)}</span>}
      </PickRow>
      {changed && !isDesktop ? (
        <PickRow title={changed === "connected" ? "Connection saved" : "Connection removed"} caption="Close Polarity and open it again to switch">
          {null}
        </PickRow>
      ) : changed ? (
        <ActionRow
          title={changed === "connected" ? "Connection saved" : "Connection removed"}
          caption="Polarity switches when it starts again"
          label="Restart Now"
          variant="primary"
          onClick={() => void appUpdates.relaunch()}
        />
      ) : (
        <>
          <FormRow
            type="password"
            placeholder="Paste a connection code"
            aria-label="Connection code"
            autoComplete="off"
            value={code}
            onChange={(v) => (setCode(v), setProblem(null))}
            submit={db ? "Replace" : "Connect"}
            pending={busy}
            error={problem}
            onSubmit={(v) => void run(() => saveDevDatabase(v), "connected")}
          />
          {db && <ActionRow title="Remove the connection" label="Remove" variant="danger" disabled={busy} onClick={() => void run(removeDevDatabase, "removed")} />}
        </>
      )}
    </Card>
  );
}

function ResetRow(props: Expandable) {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: api.resetSettings,
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      resetPrefs();
      for (const k of [keys.streamsAll, keys.continue, keys.history]) qc.invalidateQueries({ queryKey: k });
      props.onToggle();
    },
  });
  return (
    <ExpandRow icon={Reset} title="Reset all settings" caption="Put every option back to how it started" {...props}>
      <p className="settings-expand-text">
        Your library, history, profiles, add-ons, keyboard shortcuts, and API keys stay as they are.
      </p>
      <div className="settings-expand-actions">
        <Button variant="danger" disabled={reset.isPending} onClick={() => reset.mutate()}>
          <Reset size={15} /> Reset Settings
        </Button>
      </div>
      {reset.isError && <p className="settings-error">{errorMessage(reset.error)}</p>}
    </ExpandRow>
  );
}
