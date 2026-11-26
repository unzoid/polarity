import { Dialog } from "@base-ui/react/dialog";
import { Suspense, useEffect, useRef, useState } from "react";
import { setPinAsker, type PinAnswer, type PinRequest } from "../../lib/account/unlock";
import { canPreloadChunks, lazyNamed, useFormFactor, whenIdle } from "../../lib/ui";
import { FamilyTray } from "../settings/FamilyTray";
import { useDismiss } from "../../lib/ui/dismiss";
import { useTvMode } from "../../tv/tvMode";
import { Avatar } from "../Avatar";
import { Lock } from "../icons";
import { Button } from "../ui/Button";

const PinFlow = lazyNamed(() => import("./PinFlow"), "PinFlow");

type Pending = { id: number; request: PinRequest; resolve: (a: PinAnswer) => void };
let asked = 0;

/**
 * The one PIN prompt (lib/account/unlock.ts `askPin`), mounted once at the app's root so "Who's watching?", the
 * profile menu, TV mode and Settings all ask the same way. Uses the Watch Party dialog's look (styles/party.css)
 * like the sign-out question; in TV mode its keys are the TV keyboard's; on a phone it's the settings' tray.
 */
export function PinHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const tv = useTvMode();

  useEffect(() => {
    if (!canPreloadChunks()) return;
    let cancelIdle: (() => void) | undefined;
    const t = window.setTimeout(() => {
      cancelIdle = whenIdle(() => void PinFlow.preload().catch(() => {}), 5000);
    }, 6000);
    return () => {
      window.clearTimeout(t);
      cancelIdle?.();
    };
  }, []);

  useEffect(
    () =>
      setPinAsker(
        (request) =>
          new Promise<PinAnswer>((resolve) => {
            // A new question replaces one still open: that one is cancelled.
            current.current?.resolve(null);
            const next = { id: ++asked, request, resolve };
            current.current = next;
            setPending(next);
          }),
      ),
    [],
  );

  const finish = (answer: PinAnswer) => {
    const p = current.current;
    current.current = null;
    setPending(null);
    p?.resolve(answer);
  };

  // A phone asks in the settings' tray, which sits over the full-screen Profiles page and Settings.
  const tray = useFormFactor().form === "phone" && !tv;

  // On the one Back stack, so a TV remote's Back closes the prompt and not the page under it (the tray has its own).
  useDismiss(!!pending && !tray, () => finish(null));

  const request = pending?.request;
  // The tray keeps showing the last question while it closes.
  const lastRequest = useRef(request);
  if (request) lastRequest.current = request;
  const who = request?.kind === "check" && request.profiles.length === 1 ? request.profiles[0] : null;

  if (tray) {
    const shown = request ?? lastRequest.current;
    const shownWho = shown?.kind === "check" && shown.profiles.length === 1 ? shown.profiles[0] : null;
    return (
      <FamilyTray
        open={!!pending}
        onClose={() => finish(null)}
        title={shown?.title ?? ""}
        stepKey={String(pending?.id ?? "pin")}
        heroIcon={
          shownWho ? (
            <Avatar id={shownWho.avatar} className="ft-pin-avatar" />
          ) : (
            <span className="ft-pin-lock">
              <Lock size={20} />
            </span>
          )
        }
      >
        {shown?.text && <p className="ft-desc">{shown.text}</p>}
        <div className="ft-pin">
          {pending && (
            <Suspense fallback={null}>
              <PinFlow key={pending.id} request={pending.request} onDone={finish} />
            </Suspense>
          )}
        </div>
      </FamilyTray>
    );
  }

  return (
    <Dialog.Root open={!!pending} onOpenChange={(open) => !open && finish(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="party-dialog-scrim" />
        <Dialog.Popup className="party-dialog pin-dialog" data-tv={tv || undefined} data-nav-scope={tv || undefined}>
          {/* Whose PIN it is: that profile's picture; a lock for a new PIN, the account, or a choice of profiles. */}
          {who ? (
            <Avatar id={who.avatar} className="pin-dialog-avatar" />
          ) : (
            <div className="party-dialog-icon" aria-hidden>
              <Lock size={22} />
            </div>
          )}
          {request && (
            <>
              <Dialog.Title className="party-dialog-title">{request.title}</Dialog.Title>
              {request.text && <Dialog.Description className="party-dialog-text pin-dialog-text">{request.text}</Dialog.Description>}
              <Suspense fallback={null}>
                <PinFlow key={pending?.id} request={request} onDone={finish} />
              </Suspense>
            </>
          )}
          <Dialog.Close render={<Button size="block" variant="plain" className="pin-cancel" />}>Cancel</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
