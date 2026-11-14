import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import { setPinAsker, type PinAnswer, type PinRequest } from "../../lib/account/unlock";
import { useDismiss } from "../../lib/ui/dismiss";
import { useTvMode } from "../../tv/tvMode";
import { Lock } from "../icons";
import { Button } from "../ui/Button";
import { PinFlow } from "./PinFlow";

type Pending = { id: number; request: PinRequest; resolve: (a: PinAnswer) => void };
let asked = 0;

/**
 * The one PIN prompt (lib/account/unlock.ts `askPin`), mounted once at the app's root so "Who's watching?", the
 * profile menu, TV mode and Settings all ask the same way. Uses the Watch Party dialog's look (styles/party.css)
 * like the sign-out question; in TV mode its keys are the TV keyboard's.
 */
export function PinHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const tv = useTvMode();

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

  // On the one Back stack, so a TV remote's Back closes the prompt and not the page under it.
  useDismiss(!!pending, () => finish(null));

  const request = pending?.request;
  return (
    <Dialog.Root open={!!pending} onOpenChange={(open) => !open && finish(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="party-dialog-scrim" />
        <Dialog.Popup className="party-dialog pin-dialog" data-tv={tv || undefined} data-nav-scope={tv || undefined}>
          <div className="party-dialog-icon" aria-hidden>
            <Lock size={22} />
          </div>
          {request && (
            <>
              <Dialog.Title className="party-dialog-title">{request.title}</Dialog.Title>
              {request.text && <Dialog.Description className="party-dialog-text pin-dialog-text">{request.text}</Dialog.Description>}
              <PinFlow key={pending?.id} request={request} onDone={finish} />
            </>
          )}
          <Dialog.Close render={<Button size="block" variant="plain" className="pin-cancel" />}>Cancel</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
