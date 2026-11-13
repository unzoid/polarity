import { useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useAccount } from "../lib/account";
import { formatFriendCode, friendRank, friends, friendStatus, joiningText, setFriendsOpen, useFriends } from "../lib/friends";
import { getParty, joinParty, leaveParty, useParty } from "../lib/party";
import { useBack, useFocusTrap } from "./shell";

/**
 * TV mode's Friends (#135), from the side menu: a panel the remote moves down, invites first, then friends in a
 * party, watching, online, offline. OK on someone in a party joins it (the player comes up once the host lets you
 * in). Adding friends and answering requests happen on a computer or phone, where there's a keyboard: the panel
 * shows this profile's code to be added by, and says when requests are waiting. A party surface (#247): Back
 * closes it, and closing it while a host decides gives up on joining, as on the desktop.
 */
export function TvFriendsPanel() {
  const state = useFriends();
  const party = useParty();
  const { profile } = useAccount();
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const close = () => {
    if (getParty()?.knocking) leaveParty();
    setFriendsOpen(false);
  };
  useBack(true, close);

  const friendsList = state.entries
    .filter((e) => e.state === "accepted")
    .sort((a, b) => friendRank(state.presence[a.id]) - friendRank(state.presence[b.id]) || a.name.localeCompare(b.name));
  const requests = state.entries.filter((e) => e.state === "pending" && e.incoming).length;

  const join = (code: string, invite?: number) => {
    if (!profile || party?.code === code) return;
    setNote(null);
    joinParty(code, profile).then(
      () => {
        setNote(null);
        if (invite !== undefined) friends.dismissInvite(invite);
      },
      (e: Error) => setNote(e.message),
    );
  };
  const status = joiningText(party) ?? note;

  return (
    <div className="tv-panel tv-sources tv-friends" ref={ref} data-nav-scope role="dialog" aria-label="Friends">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Friends</h2>
        {state.settings && (
          <p className="tv-sources-sub">
            Your friend code <strong className="tv-friends-code tabular">{formatFriendCode(state.settings.code)}</strong>
            {requests > 0 && ` · ${requests} friend request${requests > 1 ? "s" : ""}: answer from Friends on a computer or phone`}
          </p>
        )}
        {status && (
          <p className="tv-friends-status" role="status">
            {status}
          </p>
        )}
      </header>
      {!state.settings ? (
        <p className="tv-friends-empty">Friends is off for this profile. Turn it on from Friends on a computer or phone.</p>
      ) : !friendsList.length && !state.invites.length ? (
        <p className="tv-friends-empty">No friends yet. Share your code, or add a friend by theirs on a computer or phone.</p>
      ) : (
        <div className="tv-friends-list">
          {state.invites.map((i) => (
            <button key={`invite-${i.id}`} className="tv-friend" data-online onClick={() => join(i.party, i.id)}>
              <Avatar id={i.avatar} className="tv-friend-face" />
              <span className="tv-friend-who">
                <strong>{i.name}</strong>
                <span>Invited you · Join</span>
              </span>
            </button>
          ))}
          {friendsList.map((f) => {
            const p = state.presence[f.id];
            const theirs = p?.party;
            return (
              <button
                key={f.id}
                className="tv-friend"
                data-online={!!p || undefined}
                aria-disabled={!theirs || undefined}
                onClick={() => theirs && join(theirs)}
              >
                <Avatar id={f.avatar} className="tv-friend-face" />
                <span className="tv-friend-who">
                  <strong>{f.name}</strong>
                  <span>{friendStatus(p)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
