import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, LinkIcon, Settings as Cog, Plus, Puzzle, Trash } from "../../components/icons";
import { SwapIcon } from "../../components/SwapIcon";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { keys, useAddons } from "../../lib/net";
import { errorMessage } from "../../lib/errors";
import { Button, IconButton } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { Card, ExpandRow, FormRow, useExpanded } from "../../components/settings/rows";
import { showWhereStored, useSecretsNote } from "../../components/settings/secretsNote";
import { useKeyGate, useSecretsPlain } from "../../components/settings/KeyWarning";
import { linkHasKey, useAccount, useSecretsLocked } from "../../lib/account";
import { addonHomeCatalogs, catalogKey, useAddonCatalogs, useHomeCatalogSetting, withAddonOnHome, withCatalogMoved } from "../../lib/catalog";
import { setStremioLinks, stremioLinksOs, type Os } from "../../lib/platform";
import { setPrefs } from "../../lib/settings";
import { SettingRow } from "../../components/settings/SettingRow";

const hintsTried = new Set<string>();

export function AddonsPage() {
  const qc = useQueryClient();
  const { data: addons } = useAddons();
  const [url, setUrl] = useState("");
  const expand = useExpanded();
  const note = useSecretsNote();
  const gate = useKeyGate();
  const plain = useSecretsPlain();
  // Signed in on a new device with the keys sealed (#470): said first, with the way to unlock them.
  const account = useAccount();
  const locked = useSecretsLocked(account.status === "ready" ? account.profile?.id : null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.addons });
    qc.invalidateQueries({ queryKey: keys.streamsAll });
  };
  const install = useMutation({
    mutationFn: api.installAddon,
    onSuccess: () => {
      setUrl("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: api.removeAddon, onSuccess: refresh });
  // Off or moved: what's asked, and in what order, changes for sources, subtitles and lists alike.
  const changed = () => {
    refresh();
    qc.invalidateQueries({ queryKey: ["subtitles"] });
    qc.invalidateQueries({ queryKey: keys.addonCatalogAll });
  };
  const toggle = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setAddonEnabled(id, on), onSuccess: changed });
  const move = useMutation({ mutationFn: ({ id, by }: { id: string; by: -1 | 1 }) => api.moveAddon(id, by), onSuccess: changed });

  // Manifests saved before behaviour hints were kept: refetch them once so
  // the Configure button can show.
  useEffect(() => {
    const stale = addons?.filter((a) => a.manifest.behaviorHints == null && !hintsTried.has(a.manifestUrl)) ?? [];
    if (!stale.length) return;
    for (const a of stale) hintsTried.add(a.manifestUrl);
    void Promise.allSettled(stale.map((a) => api.installAddon(a.manifestUrl))).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons]);

  return (
    <>
      {locked && (
        <div className="settings-key-warning" role="status" data-kind="locked">
          <p className="settings-expand-text">
            <strong>Your account's add-ons are locked on this device.</strong> They're encrypted with your passphrase, and can't be installed or used here until you type it.
          </p>
          <div className="settings-expand-form">
            <Button variant="primary" onClick={showWhereStored}>
              Unlock
            </Button>
          </div>
        </div>
      )}
      {!!addons?.length && (
        <Card title="Installed" footer={addons.length > 1 ? <>Equally good sources, and subtitles in one language, are listed in this order. {note}</> : note}>
          {addons.map((a, i) => (
            <ExpandRow
              key={a.manifest.id}
              icon={Puzzle}
              title={a.manifest.name}
              caption={a.disabled ? "Off" : linkHasKey(a.manifestUrl) ? "This link contains a key" : undefined}
              accessory={<CopyLink url={a.manifestUrl} name={a.manifest.name} />}
              {...expand(a.manifest.id)}
            >
              {a.manifest.description && <p className="settings-expand-text">{a.manifest.description}</p>}
              <p className="settings-expand-text settings-url">{a.manifestUrl}</p>
              {linkHasKey(a.manifestUrl) && <KeyedLinkNote plain={plain} />}
              <label className="settings-expand-toggle">
                <span>Use this add-on</span>
                <Switch checked={!a.disabled} disabled={toggle.isPending} onChange={(on) => toggle.mutate({ id: a.manifest.id, on })} />
              </label>
              {!a.disabled && <HomeLists addon={a.manifest.id} />}
              <div className="settings-expand-actions">
                {a.manifest.behaviorHints?.configurable && (
                  <Button
                    onClick={() => void api.openExternal(a.manifestUrl.replace(/\/manifest\.json$/, "/configure"))}
                    title="Opens the addon's settings page. Install the new link it gives you to apply them."
                  >
                    <Cog size={15} /> Configure
                  </Button>
                )}
                {addons.length > 1 && (
                  <>
                    <IconButton
                      variant="settings"
                      label={`Move ${a.manifest.name} up`}
                      title="Move Up: asked before the ones below it"
                      disabled={i === 0 || move.isPending}
                      onClick={() => move.mutate({ id: a.manifest.id, by: -1 })}
                    >
                      <ArrowUp size={16} />
                    </IconButton>
                    <IconButton
                      variant="settings"
                      label={`Move ${a.manifest.name} down`}
                      title="Move Down"
                      disabled={i === addons.length - 1 || move.isPending}
                      onClick={() => move.mutate({ id: a.manifest.id, by: 1 })}
                    >
                      <ArrowDown size={16} />
                    </IconButton>
                  </>
                )}
                <Button variant="danger" onClick={() => remove.mutate(a.manifest.id)} disabled={remove.isPending}>
                  <Trash size={15} /> Remove
                </Button>
              </div>
            </ExpandRow>
          ))}
        </Card>
      )}
      {addons && !addons.length && (
        <Card title="Installed" footer={note}>
          <p className="settings-card-pad settings-expand-text">No add-ons yet. Titles have no sources to play until you install one.</p>
        </Card>
      )}
      <Card
        title="Install from URL"
        footer="Looking for something to add? Browse the Marketplace."
      >
        <FormRow
          placeholder="https://…/manifest.json"
          value={url}
          onChange={setUrl}
          onSubmit={(u) => gate.guard(linkHasKey(u) ? "link" : null, () => install.mutate(u))}
          submit="Install"
          glyph={<Plus size={16} />}
          pending={install.isPending}
          pendingLabel="Installing…"
          error={install.isError && errorMessage(install.error)}
        />
        {gate.warning}
      </Card>
      <StremioLinksCard />
    </>
  );
}

/**
 * Copies an installed add-on's manifest link, to install it elsewhere or share it. The glyph turns into a
 * check for a moment to say it worked. The link is copied as it is, key included: that's what installs it.
 */
function CopyLink({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      variant="settings"
      label={copied ? `${name} link copied` : `Copy ${name} link`}
      title={copied ? "Copied" : "Copy Link"}
      onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true), () => {})}
    >
      <SwapIcon state={copied ? "copied" : "copy"}>{copied ? <Check size={16} /> : <LinkIcon size={16} />}</SwapIcon>
    </IconButton>
  );
}

/**
 * Under an installed add-on with lists of titles (#206): whether they're rows on Home, and their order there.
 * Off until switched on, so installing an add-on for its sources doesn't change Home.
 */
function HomeLists({ addon }: { addon: string }) {
  const catalogs = useAddonCatalogs();
  const [setting, set] = useHomeCatalogSetting();
  const own = addonHomeCatalogs(catalogs, setting, addon);
  if (!own.length) return null;
  const on = setting.on.includes(addon);
  return (
    <div className="settings-home-lists" data-setting="addonCatalogsHome">
      <label className="settings-expand-toggle">
        <span>{own.length === 1 ? "Show its list on Home" : `Show its ${own.length} lists on Home`}</span>
        <Switch checked={on} onChange={(v) => set(withAddonOnHome(setting, addon, v))} />
      </label>
      {on && own.length > 1 && (
        <ol className="settings-home-order" aria-label="Order on Home">
          {own.map((c, i) => (
            <li key={catalogKey(c)}>
              <span className="settings-home-name">
                {c.name} <span className="settings-home-kind">{c.type === "movie" ? "Movies" : "Series"}</span>
              </span>
              <IconButton label={`Move ${c.name} up`} disabled={i === 0} onClick={() => set(withCatalogMoved(catalogs, setting, c, -1))}>
                <ArrowUp size={15} />
              </IconButton>
              <IconButton label={`Move ${c.name} down`} disabled={i === own.length - 1} onClick={() => set(withCatalogMoved(catalogs, setting, c, 1))}>
                <ArrowDown size={15} />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** What each system does with "Open Stremio links in Polarity" (src-tauri/src/stremio_links.rs). */
const STREMIO_LINKS_ON: Record<Os, string> = {
  windows: "On: Polarity opens them on this computer. Off: they go back to the app that opened them before, such as Stremio.",
  macos: "macOS opens these links in one app. On: Polarity. Off: back to Stremio, if it's installed.",
  linux: "On: Polarity becomes the default app for these links. Off: it stops being one.",
  android: "With Stremio installed too, Android asks which app to open each link with.",
  ios: "",
};

/** Settings → Add-ons → Open Stremio links in Polarity (#163): this device's choice, on until the user turns it off (#428). */
function StremioLinksCard() {
  const os = stremioLinksOs();
  const [error, setError] = useState<string | null>(null);
  if (!os) return null;
  const change = (on: boolean) => {
    setError(null);
    setStremioLinks(on).catch((e: unknown) => {
      // The system said no: the setting says what's true.
      setPrefs({ stremioLinks: !on });
      setError(`Couldn't change which app opens Stremio links: ${errorMessage(e)}`);
    });
  };
  return (
    <Card title="Links" footer="Polarity isn't Stremio: these are links meant for Stremio, opened by Polarity.">
      <SettingRow id="stremioLinks" caption={`Links meant for the Stremio app, such as an add-on's install button or a title's link. ${STREMIO_LINKS_ON[os]}`} onChanged={(v) => change(!!v)} />
      {error && (
        <p className="settings-card-pad settings-expand-text" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

/** Under an installed add-on whose link holds a key (#195); the warning too while keys sync unencrypted. */
function KeyedLinkNote({ plain }: { plain: boolean }) {
  return (
    <p className="settings-expand-text settings-keyed" data-keyed-link>
      <strong>This link contains a key.</strong>{" "}
      {plain
        ? "It's stored on your account unencrypted: anyone with access to the account server could read it. Set a passphrase to encrypt it. "
        : "Keep it to yourself: anyone with the link can use what the key opens. "}
      <button type="button" className="settings-link" onClick={showWhereStored}>
        {plain ? "Set a passphrase" : "What's stored where"}
      </button>
    </p>
  );
}
