/**
 * A TV's code that came in a link (its QR code, lib/deepLink `tv-sign-in`), kept until Settings →
 * Account → Sign in a TV takes it and asks "Sign in on <device>?". Kept across signing in: a phone
 * that was signed out signs in first, then lands on the question with the code still there.
 * Holding a code approves nothing; only the person's Approve does.
 */
import { useEffect, useRef } from "react";
import { isTvCode, normalizeTvCode } from "./tvSignIn";

let pending: string | null = null;
const listeners = new Set<() => void>();

/** Keeps `code` for Sign in a TV (the latest one wins); anything that isn't a code is ignored. */
export function offerTvCode(code: string) {
  if (!isTvCode(code)) return;
  pending = normalizeTvCode(code);
  listeners.forEach((l) => l());
}

/** Whether a code is waiting, without taking it. */
export const hasTvCode = () => pending !== null;

/** The waiting code, once. */
export function takeTvCode(): string | null {
  const code = pending;
  pending = null;
  return code;
}

/** Sign in a TV: `onCode` with each code a link brings, the one already waiting first. */
export function useLinkedTvCode(onCode: (code: string) => void) {
  const latest = useRef(onCode);
  latest.current = onCode;
  useEffect(() => {
    const take = () => {
      const code = takeTvCode();
      if (code) latest.current(code);
    };
    take();
    listeners.add(take);
    return () => void listeners.delete(take);
  }, []);
}
