import { describe, expect, test } from "bun:test";
import { CompanionSession, parseCompanionEnvelope, type CompanionEnvelope, type CompanionTransport } from "../src/lib/party/companion";
import { applyFieldMask, createFieldMaskPatch, mergeFieldMasks } from "../src/lib/account/fieldMask";

function makeBus() {
  const listeners = new Set<(raw: unknown) => void>();
  const makeTransport = (): CompanionTransport => ({
    send(env: CompanionEnvelope) {
      queueMicrotask(() => {
        for (const fn of listeners) fn(env);
      });
    },
    onMessage(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  });
  return { makeTransport };
}

describe("Phone <-> TV Companion Mode (#563)", () => {
  test("validates and clamps envelopes strictly", () => {
    expect(parseCompanionEnvelope({ v: 2, from: "a", to: "b", msgId: "1", type: "back", payload: {} })).toBeNull();
    expect(parseCompanionEnvelope({ v: 1, from: "a", to: "b", msgId: "1", type: "search", payload: { query: "" } })).toBeNull();
    const seek = parseCompanionEnvelope({ v: 1, from: "phone", to: "tv", msgId: "m1", type: "seek", payload: { deltaSec: 9999 } });
    expect(seek?.type).toBe("seek");
    if (seek?.type === "seek") expect(seek.payload.deltaSec).toBe(600);
  });

  test("discovers TV peers first and delivers addressed commands with direct acks", async () => {
    const bus = makeBus();
    const now = Date.UTC(2026, 10, 22);
    const received: string[] = [];

    const tv = new CompanionSession(
      { deviceId: "tv-1", name: "Living Room TV", platform: "tv", updatedAt: now },
      bus.makeTransport(),
      (cmd) => {
        if (cmd.type === "search") received.push(cmd.payload.query);
        return true;
      },
      () => now,
    );
    const phone = new CompanionSession(
      { deviceId: "phone-1", name: "Phone", platform: "phone", updatedAt: now },
      bus.makeTransport(),
      undefined,
      () => now,
    );

    phone.syncPresence([
      { deviceId: "desk-1", name: "Desktop", platform: "desktop", updatedAt: now },
      { deviceId: "tv-1", name: "Living Room TV", platform: "tv", updatedAt: now },
      { deviceId: "old-tv", name: "Stale TV", platform: "tv", updatedAt: now - 120_000 },
    ]);
    expect(phone.listPeers().map((p) => p.deviceId)).toEqual(["tv-1", "desk-1"]);

    const acked = await phone.sendCommand("tv-1", { type: "search", payload: { query: "Big Buck Bunny" } }, 500);
    expect(acked).toBe(true);
    expect(received).toEqual(["Big Buck Bunny"]);

    const missed = await phone.sendCommand("missing-tv", { type: "back", payload: {} }, 30);
    expect(missed).toBe(false);

    tv.close();
    phone.close();
  });
});

describe("Explicit FieldMask patches (#454)", () => {
  test("updates masked keys, resets masked-omitted keys to default, and preserves unknown future keys", () => {
    const defaults = { subtitleLanguage: "eng", autoSkip: true, frameRateMatch: "off" };
    const desktopState: Record<string, unknown> = {
      subtitleLanguage: "eng",
      autoSkip: false,
      frameRateMatch: "seamless",
      futureDesktopFlag: 42,
    };

    // Lightweight TV client edits subtitleLanguage and resets autoSkip back to default, knowing nothing about frameRateMatch or futureDesktopFlag.
    const tvPatch = createFieldMaskPatch(
      { subtitleLanguage: "eng", autoSkip: false },
      { subtitleLanguage: "jpn", autoSkip: true },
      { subtitleLanguage: "eng", autoSkip: true },
    );
    expect(tvPatch).toEqual({ mask: ["subtitleLanguage", "autoSkip"], patch: { subtitleLanguage: "jpn" } });

    const next = applyFieldMask(desktopState, defaults, tvPatch);
    expect(next).toEqual({
      subtitleLanguage: "jpn",
      autoSkip: true,
      frameRateMatch: "seamless",
      futureDesktopFlag: 42,
    });

    const composed = mergeFieldMasks(tvPatch, { mask: ["subtitleLanguage"], patch: {} });
    expect(composed.patch).toEqual({});
    expect(applyFieldMask(desktopState, defaults, composed).subtitleLanguage).toBe("eng");
  });
});
