import { describe, expect, test } from "bun:test";
import { PARTY_REACTIONS, parseMessage } from "../src/lib/party/messages";
import { partyOfTwo } from "./partySim";

describe("Tier 4: Watch Party social protocol (reactions, chat, syncEveryone)", () => {
  test("parseMessage validates allowed reactions and rejects arbitrary strings", () => {
    for (const emoji of PARTY_REACTIONS) {
      expect(parseMessage({ t: "react", from: "m-1", emoji })).toEqual({ t: "react", from: "m-1", emoji });
    }
    expect(parseMessage({ t: "react", from: "m-1", emoji: "💩" })).toBeNull();
    expect(parseMessage({ t: "react", from: "m-1", emoji: "<script>" })).toBeNull();
    expect(parseMessage({ t: "react", from: "m-1", emoji: 123 })).toBeNull();
  });

  test("parseMessage sanitizes and bounds chat messages", () => {
    const clean = parseMessage({ t: "chat", from: "m-1", id: "msg-1", text: "  hello\n\tworld  " });
    expect(clean).toEqual({ t: "chat", from: "m-1", id: "msg-1", text: "hello world" });

    const long = parseMessage({ t: "chat", from: "m-1", id: "msg-2", text: "a".repeat(300) });
    expect(long?.t === "chat" && long.text.length).toBe(240);

    expect(parseMessage({ t: "chat", from: "m-1", id: "msg-3", text: "   \n  " })).toBeNull();
    expect(parseMessage({ t: "chat", from: "m-1", id: "bad id!", text: "hi" })).toBeNull();
  });

  test("members exchange floating reactions that expire and ephemeral chat lines without duplication", () => {
    const { sim, a, b } = partyOfTwo({});
    sim.run(2_000);

    expect(a.room.sendReaction("🔥")).toBe(true);
    // Cooldown prevents spam bursts within 250ms
    expect(a.room.sendReaction("😂")).toBe(false);
    sim.run(200);
    expect(a.room.getParty()!.reactions.map((r) => r.emoji)).toEqual(["🔥"]);
    expect(b.room.getParty()!.reactions.map((r) => r.emoji)).toEqual(["🔥"]);
    expect(b.room.getParty()!.reactions[0]!.who?.name).toBeTruthy();

    // Reactions expire cleanly after ~2.8s
    sim.run(3_000);
    expect(a.room.getParty()!.reactions).toEqual([]);
    expect(b.room.getParty()!.reactions).toEqual([]);

    // Chat delivery without echo duplication
    expect(b.room.sendChat("  That twist!!  ")).toBe(true);
    sim.run(200);
    expect(b.room.getParty()!.chat.map((c) => c.text)).toEqual(["That twist!!"]);
    expect(a.room.getParty()!.chat.map((c) => c.text)).toEqual(["That twist!!"]);
    expect(a.room.getParty()!.chat[0]!.who?.id).toBe(b.room.getParty()!.me);
  });

  test("syncEveryone broadcasts an authoritative timeline bump from the host only", () => {
    const { sim, a, b } = partyOfTwo({});
    sim.run(2_000);

    const beforeV = a.room.getParty()!.playback!.v;
    // Non-host cannot trigger syncEveryone
    expect(b.room.syncEveryone(120)).toBe(false);
    expect(a.room.getParty()!.playback!.v).toBe(beforeV);

    // Host broadcasts authoritative state and note
    expect(a.room.syncEveryone(245)).toBe(true);
    sim.run(200);
    expect(a.room.getParty()!.playback!.v).toBeGreaterThan(beforeV);
    expect(b.room.getParty()!.playback!.v).toBe(a.room.getParty()!.playback!.v);
    expect(a.room.getParty()!.notes.some((n) => n.text.includes("synced everyone"))).toBe(true);
  });
});
