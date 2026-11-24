import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, Check, Grip, LinkIcon, Settings as Cog, Plus, Puzzle, Trash } from "../../components/icons";
import { SwapIcon } from "../../components/SwapIcon";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { api } from "../../lib/api";
import { keys, useAddons } from "../../lib/net";
import { errorMessage } from "../../lib/errors";
import { Button, IconButton } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { Card, ExpandRow, FormRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { showWhereStored, useSecretsNote } from "../../components/settings/secretsNote";
import { useKeyGate, useSecretsPlain } from "../../components/settings/KeyWarning";
import { linkHasKey, useAccount, useSecretsLocked } from "../../lib/account";
import { addonHomeCatalogs, catalogKey, useAddonCatalogs, useHomeCatalogSetting, withAddonOnHome, withCatalogMoved } from "../../lib/catalog";
import { setStremioLinks, stremioLinksOs } from "../../lib/platform";
import { setPrefs } from "../../lib/settings";
import { SettingRow } from "../../components/settings/SettingRow";
import { useFormFactor } from "../../lib/ui";
import type { InstalledAddon } from "../../lib/types";

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
  const phone = useFormFactor().form === "phone";
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
  const changed = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.addons }),
      qc.invalidateQueries({ queryKey: keys.streamsAll }),
      qc.invalidateQueries({ queryKey: ["subtitles"] }),
      qc.invalidateQueries({ queryKey: keys.addonCatalogAll }),
    ]);
  const toggle = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setAddonEnabled(id, on), onSuccess: changed });
  // The order being dragged, and kept until the saved one is read back, so the rows don't jump back between.
  const [draft, setDraftState] = useState<string[] | null>(null);
  // The latest order as soon as it's given, for the drop to save: a swap in the drag's last frame may not
  // have rendered yet when the drag ends.
  const draftRef = useRef<string[] | null>(null);
  const setDraft = (next: string[] | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const reorder = useMutation({
    mutationFn: api.reorderAddons,
    // Cleared only if no later drag has started a newer order meanwhile.
    onSettled: (_r, _e, ids) => changed().finally(() => draftRef.current === ids && setDraft(null)),
  });
  const order = draft ?? addons?.map((a) => a.manifest.id) ?? [];
  const byId = new Map(addons?.map((a) => [a.manifest.id, a]));
  // Rows slide into their new places only while they're being reordered: animating layout at other times
  // would also tween a row opening or closing, stretching the rows as it goes.
  const [dragging, setDragging] = useState(false);
  const moving = dragging || draft !== null;
  // A dragged row stays inside the card.
  const listRef = useRef<HTMLDivElement>(null);

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
        // The card's list is the drag's Reorder.Group, so the card is drawn here rather than by <Card>.
        <section className="settings-group">
          <h2 className="settings-group-title">Installed</h2>
          <Reorder.Group as="div" axis="y" ref={listRef} className="settings-card addon-list" values={order} onReorder={setDraft}>
            {order.map((id, i) => {
              const a = byId.get(id);
              if (!a) return null;
              return (
                <AddonItem
                  key={id}
                  addon={a}
                  sortable={order.length > 1}
                  moving={moving}
                  bounds={listRef}
                  onLift={() => setDragging(true)}
                  onDrop={() => {
                    setDragging(false);
                    if (draftRef.current) reorder.mutate(draftRef.current);
                  }}
                  onStep={(by) => {
                    const to = i + by;
                    if (to < 0 || to >= order.length) return;
                    const next = [...order];
                    [next[i], next[to]] = [next[to], next[i]];
                    setDraft(next);
                    reorder.mutate(next);
                  }}
                  onEnable={(on) => toggle.mutate({ id, on })}
                  enabling={toggle.isPending}
                  {...expand(id)}
                >
                  {a.manifest.description && <p className="settings-expand-text">{a.manifest.description}</p>}
                  <p className="settings-expand-text settings-url">{a.manifestUrl}</p>
                  {linkHasKey(a.manifestUrl) && <KeyedLinkNote plain={plain} />}
                  {phone && (
                    <label className="settings-expand-toggle">
                      <span>Enabled</span>
                      <Switch checked={!a.disabled} disabled={toggle.isPending} onChange={(on) => toggle.mutate({ id, on })} />
                    </label>
                  )}
                  {!a.disabled && <HomeLists addon={id} />}
                  <div className="settings-expand-actions">
                    {phone && <CopyLinkPill url={a.manifestUrl} name={a.manifest.name} />}
                    {a.manifest.behaviorHints?.configurable && <ConfigureButton manifestUrl={a.manifestUrl} />}
                    <Button
                      variant="danger"
                      busy={remove.isPending && remove.variables === id}
                      disabled={remove.isPending && remove.variables === id}
                      onClick={() => remove.mutate(id)}
                    >
                      <Trash size={15} /> Remove
                    </Button>
                  </div>
                </AddonItem>
              );
            })}
          </Reorder.Group>
          <p className="settings-footer">
            {addons.length > 1 ? <>Drag to change the order: equally good sources, and subtitles in one language, are listed in it. {note}</> : note}
          </p>
        </section>
      )}
      {addons && !addons.length && (
        <Card title="Installed" footer={note}>
          <p className="settings-card-pad settings-expand-text">No add-ons yet. Titles have no sources to play until you install one.</p>
        </Card>
      )}
      <Card title={phone ? undefined : "Install from URL"}>
        <FormRow
          title="Install from URL"
          icon={Plus}
          emptyValue="Paste link"
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
 * One installed add-on: its row, moved by dragging it (or its handle, the only way on touch, where a
 * press on the row has to scroll the page), and by the handle's arrow keys. A drag doesn't open the row.
 */
function AddonItem({
  addon: a,
  sortable,
  moving,
  bounds,
  onLift,
  onDrop,
  onStep,
  onEnable,
  enabling,
  children,
  ...expand
}: Expandable & {
  addon: InstalledAddon;
  sortable: boolean;
  /** The list is being reordered: rows animate into their new places. */
  moving: boolean;
  /** The list a drag stays inside. */
  bounds: RefObject<HTMLDivElement | null>;
  onLift: () => void;
  onDrop: () => void;
  onStep: (by: -1 | 1) => void;
  onEnable: (on: boolean) => void;
  enabling: boolean;
  children: ReactNode;
}) {
  const phone = useFormFactor().form === "phone";
  const controls = useDragControls();
  const dragged = useRef(false);
  const [lifted, setLifted] = useState(false);
  const name = a.manifest.name;
  return (
    <Reorder.Item
      as="div"
      value={a.manifest.id}
      className="addon-item"
      data-off={a.disabled || undefined}
      data-lifted={lifted || undefined}
      // The handle takes the keys; the row itself isn't a stop of its own (Reorder.Item makes it one).
      tabIndex={-1}
      // Layout is always measured (it keeps the drag's bounds current) but only animated while reordering:
      // a row opening or closing moves the rows below at once.
      layout="position"
      transition={moving ? undefined : { layout: { duration: 0 } }}
      drag={sortable ? "y" : false}
      dragListener={false}
      dragControls={controls}
      dragConstraints={bounds}
      dragElastic={0}
      onDragStart={() => {
        dragged.current = true;
        setLifted(true);
        onLift();
      }}
      onDragEnd={() => {
        setLifted(false);
        onDrop();
      }}
      onPointerDown={(e) => {
        dragged.current = false;
        if (sortable && e.pointerType === "mouse" && e.button === 0 && (e.target as Element).closest(".settings-row-button")) controls.start(e);
      }}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
      }}
    >
      <ExpandRow
        handle={
          sortable && (
            <button
              type="button"
              className="addon-grip"
              aria-label={`Move ${name}: drag, or use the up and down arrow keys`}
              title="Drag to Reorder"
              onPointerDown={(e) => {
                dragged.current = false;
                controls.start(e);
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                e.stopPropagation(); // not also to Reorder.Item's own key handling
                onStep(e.key === "ArrowUp" ? -1 : 1);
              }}
            >
              <Grip size={14} />
            </button>
          )
        }
        lead={<AddonLogo key={`${a.manifestUrl} ${a.manifest.logo ?? ""}`} addon={a} />}
        title={name}
        caption={linkHasKey(a.manifestUrl) ? "This link contains a key" : undefined}
        value={phone ? (a.disabled ? "Disabled" : "Enabled") : undefined}
        accessory={
          <>
            <CopyLink url={a.manifestUrl} name={name} />
            <button
              type="button"
              className="addon-power"
              aria-pressed={!a.disabled}
              aria-label={`Use ${name}`}
              title={a.disabled ? "Off: asked for nothing. Click to turn it on." : "On. Click to turn it off; it stays installed."}
              disabled={enabling}
              onClick={() => onEnable(!!a.disabled)}
            >
              {a.disabled ? "Disabled" : "Enabled"}
            </button>
          </>
        }
        {...expand}
      >
        {children}
      </ExpandRow>
    </Reorder.Item>
  );
}

/**
 * An add-on's own logo (its manifest's `logo`), else its site's icon, else the puzzle piece. Each one that
 * fails to load gives way to the next.
 */
function AddonLogo({ addon }: { addon: InstalledAddon }) {
  const sources = [addon.manifest.logo, siteIcon(addon.manifestUrl)].filter((s): s is string => !!s);
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  if (!src) return <Puzzle className="settings-row-icon" size={20} strokeWidth={1.9} />;
  return <img className="settings-row-icon addon-logo" src={src} alt="" draggable={false} onError={() => setFailed((n) => n + 1)} />;
}

/** The add-on's site's icon: `/favicon.ico` on the host it's installed from (only the host: the path can hold a key). */
function siteIcon(manifestUrl: string): string | undefined {
  try {
    const u = new URL(manifestUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? `${u.origin}/favicon.ico` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens the add-on's settings page (`<base>/configure`, next to its manifest) in the browser. The page gives a
 * new link to install; a failure to open it is said under the button rather than lost.
 */
function ConfigureButton({ manifestUrl }: { manifestUrl: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={() => {
          setError(null);
          api.openExternal(manifestUrl.replace(/\/manifest\.json$/, "/configure")).catch((e: unknown) => setError(`Couldn't open its settings page: ${errorMessage(e)}`));
        }}
        title="Opens the add-on's settings page. Install the new link it gives you to apply them."
      >
        <Cog size={15} /> Configure
      </Button>
      {error && (
        <p className="settings-expand-text addon-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function CopyLinkPill({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Button
      aria-label={copied ? `${name} link copied` : `Copy ${name} link`}
      onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true), () => {})}
    >
      {copied ? <Check size={15} /> : <LinkIcon size={15} />}
      {copied ? "Copied" : "Copy Link"}
    </Button>
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
    <Card title="Links">
      <SettingRow id="stremioLinks" onChanged={(v) => change(!!v)} />
      {error && (
        <p className="settings-card-pad settings-error" role="alert">
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
