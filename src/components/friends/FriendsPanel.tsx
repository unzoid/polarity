import { useEffect, useRef, useState, type ElementType } from "react";
import { useProfileMenuHosts } from "../profileSheetHost";
import { Dialog } from "@base-ui/react/dialog";
import { useAccount, type FriendEntry, type FriendPresence } from "../../lib/account";
import {
  formatFriendCode,
  friendRank,
  friends,
  friendStatus,
  FRIEND_CODE_LENGTH,
  joiningText,
  normalizeFriendCode,
  setFriendsOpen,
  useFriends,
  useFriendsOpen,
} from "../../lib/friends";
import { getParty, joinParty, leaveParty, useParty } from "../../lib/party";
import { useNavigation } from "../../lib/router";
import { openSettings } from "../../lib/settings";
import { errorMessage } from "../../lib/errors";
import { Avatar } from "../Avatar";
import { Spinner } from "../Spinner";
import { Check, Close, Copy, More, Users } from "../icons";
import { SwapIcon } from "../SwapIcon";
import { Button, iconButtonClass } from "../ui/Button";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../ui/Menu";

/**
 * The Friends panel (#135), from the profile menu: this profile's friend code, adding a friend by
 * theirs, requests to answer, and friends with what they're doing, joined or invited in one press.
 * While Friends is off it says what turning it on does. What friends see is set in Settings →
 * Account. A party surface (lib/party/surface.ts): the player coming up closes it.
 */
export function FriendsPanel() {
  const open = useFriendsOpen();
  // The profile menu shows it as one of its views instead (ProfileMenu.tsx), but on iOS.
  const inSheet = useProfileMenuHosts();
  return (
    <Dialog.Root
      open={open && !inSheet}
      onOpenChange={(o) => {
        if (o) return;
        // Closed while waiting for a friend's host: that's giving up on joining.
        if (getParty()?.knocking) leaveParty();
        setFriendsOpen(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="party-dialog-scrim" />
        <Dialog.Popup className="party-dialog friends-dialog">
          <div className="party-dialog-icon" aria-hidden>
            <Users size={22} />
          </div>
          <Dialog.Title className="party-dialog-title">Friends</Dialog.Title>
          <FriendsBody />
          <Dialog.Close className={iconButtonClass("party")} aria-label="Close">
            <Close size={18} />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The panel's content; `inDialog: false` for the profile sheet, where there's no dialog to describe. */
export function FriendsBody({ inDialog = true }: { inDialog?: boolean }) {
  const Description: ElementType = inDialog ? Dialog.Description : "p";
  const state = useFriends();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state.checked) {
    return state.profileId ? (
      <div className="friends-loading">
        <Spinner size={22} />
      </div>
    ) : null;
  }
  if (!state.settings) {
    const turnOn = () => {
      setBusy(true);
      setError(null);
      friends.setOn(true).then(
        () => setBusy(false),
        (e) => {
          setBusy(false);
          setError(errorMessage(e));
        },
      );
    };
    return (
      <>
        <Description className="party-dialog-text">
          Add friends with a friend code, see when they're online and what they're watching, and join their watch parties in one press. Off until you turn it
          on, for this profile only.
        </Description>
        <p className="friends-fine">Friends will see that you're online, what you watch, and can join your watch party. You can change each in Settings → Account.</p>
        <Button variant="primary" className="party-dialog-ok" busy={busy} onClick={turnOn}>
          Turn On Friends
        </Button>
        <p className="party-join-error" role="alert" data-shown={!!(error ?? state.error)}>
          {error ?? state.error}
        </p>
      </>
    );
  }

  const incoming = state.entries.filter((e) => e.state === "pending" && e.incoming);
  const sent = state.entries.filter((e) => e.state === "pending" && !e.incoming);
  const blocked = state.entries.filter((e) => e.state === "blocked");
  const accepted = state.entries
    .filter((e) => e.state === "accepted")
    .sort((a, b) => friendRank(state.presence[a.id]) - friendRank(state.presence[b.id]) || a.name.localeCompare(b.name));

  return (
    <div className="friends-body">
      <OwnCode code={state.settings.code} />
      <AddFriend />
      {state.invites.length > 0 && (
        <Section title="Invites">
          {state.invites.map((i) => (
            <InviteRow key={i.id} name={i.name} avatar={i.avatar} party={i.party} onDismiss={() => friends.dismissInvite(i.id)} />
          ))}
        </Section>
      )}
      {incoming.length > 0 && (
        <Section title="Requests">
          {incoming.map((e) => (
            <Row key={e.id} entry={e} line="Wants to be friends" actions={(onError) => <RequestActions entry={e} onError={onError} />} />
          ))}
        </Section>
      )}
      <Section title="Friends">
        {accepted.length === 0 && <p className="friends-empty">No friends yet. Share your code, or add a friend by theirs.</p>}
        {accepted.map((e) => (
          <FriendRow key={e.id} entry={e} presence={state.presence[e.id]} />
        ))}
      </Section>
      {sent.length > 0 && (
        <Section title="Sent">
          {sent.map((e) => (
            <Row key={e.id} entry={e} line="Request sent" actions={(onError) => <Act label="Withdraw" run={() => friends.remove(e.id)} onError={onError} />} />
          ))}
        </Section>
      )}
      {blocked.length > 0 && (
        <Section title="Blocked">
          {blocked.map((e) => (
            <Row key={e.id} entry={e} line="Blocked" actions={(onError) => <Act label="Unblock" run={() => friends.unblock(e.id)} onError={onError} />} />
          ))}
        </Section>
      )}
      <JoiningNote />
      {/* The dialog's pointer to what friends see; a phone's sheet leaves it out (Account is a row of its list). */}
      {inDialog && (
        <button
          type="button"
          className="friends-settings-link"
          onClick={() => {
            setFriendsOpen(false);
            openSettings("account");
          }}
        >
          What friends see: Settings → Account
        </button>
      )}
    </div>
  );
}

function JoiningNote() {
  const text = joiningText(useParty());
  return (
    <p className="party-join-note" role="status" data-shown={!!text}>
      {text}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="friends-section" aria-label={title}>
      <h3 className="party-kicker">{title}</h3>
      <ul className="friends-list">{children}</ul>
    </section>
  );
}

/** This profile's code, to read out or copy. */
function OwnCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard.writeText(`Add me as a friend on Polarity. Friend code: ${formatFriendCode(code)}`).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <>
      <div className="friends-code-row">
        <div>
          <span className="party-kicker">Your friend code</span>
          <div className="friends-code tabular" aria-label={`Friend code ${code.split("").join(" ")}`}>
            {formatFriendCode(code)}
          </div>
        </div>
        <div className="friends-code-actions">
          {/* The code is the lead here: copying it is a quiet icon beside it, a check for a moment once done. */}
          <button
            type="button"
            className={iconButtonClass("plain")}
            aria-label={copied ? "Copied" : "Copy friend code"}
            title={copied ? "Copied" : "Copy friend code"}
            onClick={copy}
          >
            <SwapIcon state={copied ? "copied" : "copy"}>{copied ? <Check size={18} /> : <Copy size={18} />}</SwapIcon>
          </button>
          <MenuRoot>
            <MenuTrigger className={iconButtonClass("plain")} aria-label="Friend code options">
              <More size={18} />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                onClick={() => {
                  setError(null);
                  void friends.newCode().catch((e) => setError(errorMessage(e)));
                }}
              >
                New Code (the old one stops working)
              </MenuItem>
            </MenuPopup>
          </MenuRoot>
        </div>
      </div>
      {error && (
        <p className="friends-code-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const ADDED = { sent: "Request sent.", accepted: "You're friends now.", already: "Already friends, or asked already.", blocked: "You blocked that profile." };

function AddFriend() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const submit = () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    friends.add(code).then(
      (r) => {
        setBusy(false);
        setCode("");
        setNote({ text: ADDED[r], error: false });
      },
      (e) => {
        setBusy(false);
        setNote({ text: errorMessage(e), error: true });
      },
    );
  };
  return (
    <form
      className="party-join friends-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="party-join-input tabular"
        aria-label="Friend code"
        placeholder="Friend's code"
        autoComplete="off"
        spellCheck={false}
        maxLength={200} // room for a pasted link
        value={code}
        data-invalid={!!note?.error}
        onChange={(e) => {
          setCode(e.target.value);
          setNote(null);
        }}
      />
      <Button variant="glass" className="party-join-btn" type="submit" disabled={busy || normalizeFriendCode(code).length !== FRIEND_CODE_LENGTH} busy={busy}>
        Add
      </Button>
      <p className={note?.error ? "party-join-error" : "party-join-note"} role={note?.error ? "alert" : "status"} data-shown={!!note}>
        {note?.text}
      </p>
    </form>
  );
}

type ErrorSink = (msg: string | null) => void;

function Row({
  entry,
  line,
  onLineClick,
  online,
  actions,
}: {
  entry: FriendEntry;
  line: string;
  onLineClick?: () => void;
  online?: boolean;
  actions: (onError: ErrorSink) => React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="friends-row" data-online={online || undefined}>
      <span className="friends-face">
        <Avatar id={entry.avatar} />
      </span>
      <span className="friends-who">
        <strong>{entry.name}</strong>
        {onLineClick ? (
          <button type="button" className="friends-watching-link" onClick={onLineClick}>
            {line}
          </button>
        ) : (
          <span>{line}</span>
        )}
      </span>
      <span className="friends-actions">{actions(setError)}</span>
      {error && (
        <span className="friends-row-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

/** A button that runs a change and surfaces its error inline under the row. */
function Act({
  label,
  run,
  variant = "glass",
  onError,
}: {
  label: string;
  run: () => Promise<unknown>;
  variant?: "glass" | "primary";
  onError: ErrorSink;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
      busy={busy}
      onClick={() => {
        setBusy(true);
        onError(null);
        run()
          .catch((e) => onError(errorMessage(e)))
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </Button>
  );
}

function RequestActions({ entry, onError }: { entry: FriendEntry; onError: ErrorSink }) {
  return (
    <>
      <Act label="Accept" variant="primary" run={() => friends.respond(entry.id, true)} onError={onError} />
      <Act label="Decline" run={() => friends.respond(entry.id, false)} onError={onError} />
      <MoreMenu entry={entry} remove={false} onError={onError} />
    </>
  );
}

function MoreMenu({ entry, remove, onError }: { entry: FriendEntry; remove: boolean; onError: ErrorSink }) {
  const run = (fn: () => Promise<unknown>) => {
    onError(null);
    void fn().catch((e) => onError(errorMessage(e)));
  };
  return (
    <MenuRoot>
      <MenuTrigger className={iconButtonClass("plain")} aria-label={`More for ${entry.name}`}>
        <More size={18} />
      </MenuTrigger>
      <MenuPopup align="end">
        {remove && <MenuItem onClick={() => run(() => friends.remove(entry.id))}>Remove Friend</MenuItem>}
        <MenuItem onClick={() => run(() => friends.block(entry.id))}>Block</MenuItem>
      </MenuPopup>
    </MenuRoot>
  );
}

function FriendRow({ entry, presence }: { entry: FriendEntry; presence: FriendPresence | undefined }) {
  const party = useParty();
  const { navigate } = useNavigation();
  const mine = party && !party.knocking ? party.code : null;
  const theirs = presence?.party;
  const watching = presence?.watching;
  const openWatching =
    watching && watching.metaId
      ? () => {
          setFriendsOpen(false);
          navigate({ name: "detail", type: watching.type, id: watching.metaId });
        }
      : undefined;
  return (
    <Row
      entry={entry}
      line={friendStatus(presence)}
      onLineClick={openWatching}
      online={!!presence}
      actions={(onError) => (
        <>
          {theirs && theirs !== party?.code && <JoinButton party={theirs} onError={onError} />}
          {mine && presence && theirs !== mine && <InviteButton id={entry.id} onError={onError} />}
          <MoreMenu entry={entry} remove onError={onError} />
        </>
      )}
    />
  );
}

/** Joins a friend's party: the player comes up once the host has let this profile in. */
function JoinButton({ party, onError }: { party: string; onError: ErrorSink }) {
  const { profile } = useAccount();
  const [busy, setBusy] = useState(false);
  if (!profile) return null;
  return (
    <Button
      variant="primary"
      size="sm"
      busy={busy}
      onClick={() => {
        setBusy(true);
        onError(null);
        joinParty(party, profile).then(
          () => {
            setBusy(false);
            setFriendsOpen(false);
          },
          (e: unknown) => {
            setBusy(false);
            onError(errorMessage(e));
          },
        );
      }}
    >
      Join
    </Button>
  );
}

function InviteButton({ id, onError }: { id: string; onError: ErrorSink }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  useEffect(() => {
    if (state !== "sent") return;
    const t = window.setTimeout(() => setState("idle"), 4000);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <Button
      variant="glass"
      size="sm"
      busy={state === "busy"}
      disabled={state === "sent"}
      onClick={() => {
        setState("busy");
        onError(null);
        friends.invite(id).then(
          () => setState("sent"),
          (e) => {
            onError(errorMessage(e));
            setState("idle");
          },
        );
      }}
    >
      {state === "sent" ? "Invited" : "Invite"}
    </Button>
  );
}

/** An invite into a friend's party: Join, or let it go. */
export function InviteRow({ name, avatar, party, onDismiss }: { name: string; avatar: string; party: string; onDismiss: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="friends-row" data-online>
      <span className="friends-face">
        <Avatar id={avatar} />
      </span>
      <span className="friends-who">
        <strong>{name}</strong>
        <span>Invited you to a watch party</span>
      </span>
      <span className="friends-actions">
        <JoinButton party={party} onError={setError} />
        <Button variant="glass" size="sm" onClick={onDismiss}>
          Not Now
        </Button>
      </span>
      {error && (
        <span className="friends-row-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
