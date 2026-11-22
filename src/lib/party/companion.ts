import { isRecord, str } from "../parse";
import type { ContentType } from "../types";

/**
 * Phone <-> TV Companion Mode protocol (Netflix Pushy D2D pattern, #563).
 *
 * Runs purely over ephemeral Supabase Realtime Presence + Broadcast (~0 bytes Postgres storage):
 * same-account devices announce presence (`deviceId`, `platform`, `activeTitle`) and exchange
 * thin addressed JSON envelopes (`{ v, from, to, msgId, type, payload }`) with direct acks,
 * enabling instant phone keyboard search, title handoff, and playback remote control on TV.
 */

export type CompanionPlatform = "phone" | "tablet" | "desktop" | "tv";

export interface CompanionDevice {
  deviceId: string;
  name: string;
  platform: CompanionPlatform;
  activeTitle?: string;
  updatedAt: number;
}

export type CompanionCommand =
  | { type: "search"; payload: { query: string } }
  | { type: "openTitle"; payload: { contentType: ContentType; metaId: string; videoId?: string } }
  | { type: "playPause"; payload: { paused?: boolean } }
  | { type: "seek"; payload: { deltaSec?: number; positionSec?: number } }
  | { type: "volume"; payload: { delta?: number; muted?: boolean } }
  | { type: "back"; payload: Record<string, never> }
  | { type: "ack"; payload: { msgId: string; ok: boolean; error?: string } };

export type CompanionEnvelope = CompanionCommand & {
  v: 1;
  from: string;
  to: string;
  msgId: string;
  ts: number;
};

export interface CompanionTransport {
  send(envelope: CompanionEnvelope): void;
  onMessage(handler: (raw: unknown) => void): () => void;
}

const MAX_QUERY_LEN = 200;
const MAX_ID_LEN = 96;
const STALE_PEER_MS = 45_000;
const ACK_TIMEOUT_MS = 4000;

/** Strictly validate and parse an incoming companion envelope from Realtime broadcast. */
export function parseCompanionEnvelope(raw: unknown): CompanionEnvelope | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const from = str(raw.from);
  const to = str(raw.to);
  const msgId = str(raw.msgId);
  const type = str(raw.type);
  const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : Date.now();
  if (!from || !to || !msgId || !type || from.length > MAX_ID_LEN || to.length > MAX_ID_LEN || msgId.length > MAX_ID_LEN) {
    return null;
  }
  const p = isRecord(raw.payload) ? raw.payload : {};

  switch (type) {
    case "search": {
      const query = str(p.query)?.trim();
      if (!query || query.length > MAX_QUERY_LEN) return null;
      return { v: 1, from, to, msgId, ts, type: "search", payload: { query } };
    }
    case "openTitle": {
      const ct = p.contentType === "movie" || p.contentType === "series" ? p.contentType : null;
      const metaId = str(p.metaId);
      const videoId = str(p.videoId);
      if (!ct || !metaId || metaId.length > MAX_ID_LEN) return null;
      return { v: 1, from, to, msgId, ts, type: "openTitle", payload: { contentType: ct, metaId, ...(videoId ? { videoId } : {}) } };
    }
    case "playPause":
      return {
        v: 1,
        from,
        to,
        msgId,
        ts,
        type: "playPause",
        payload: typeof p.paused === "boolean" ? { paused: p.paused } : {},
      };
    case "seek": {
      const deltaSec = typeof p.deltaSec === "number" && Number.isFinite(p.deltaSec) ? Math.max(-600, Math.min(600, p.deltaSec)) : undefined;
      const positionSec = typeof p.positionSec === "number" && Number.isFinite(p.positionSec) && p.positionSec >= 0 ? p.positionSec : undefined;
      if (deltaSec == null && positionSec == null) return null;
      return { v: 1, from, to, msgId, ts, type: "seek", payload: { ...(deltaSec != null ? { deltaSec } : {}), ...(positionSec != null ? { positionSec } : {}) } };
    }
    case "volume": {
      const delta = typeof p.delta === "number" && Number.isFinite(p.delta) ? Math.max(-1, Math.min(1, p.delta)) : undefined;
      const muted = typeof p.muted === "boolean" ? p.muted : undefined;
      if (delta == null && muted == null) return null;
      return { v: 1, from, to, msgId, ts, type: "volume", payload: { ...(delta != null ? { delta } : {}), ...(muted != null ? { muted } : {}) } };
    }
    case "back":
      return { v: 1, from, to, msgId, ts, type: "back", payload: {} };
    case "ack": {
      const ackId = str(p.msgId);
      if (!ackId || typeof p.ok !== "boolean") return null;
      const error = str(p.error);
      return { v: 1, from, to, msgId, ts, type: "ack", payload: { msgId: ackId, ok: p.ok, ...(error ? { error } : {}) } };
    }
    default:
      return null;
  }
}

/**
 * Manages one device's Companion Mode session: tracks active same-account peer devices,
 * sends addressed remote commands with direct ack confirmation, and handles incoming commands.
 */
export class CompanionSession {
  private peers = new Map<string, CompanionDevice>();
  private pendingAcks = new Map<string, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private unsub: () => void;
  private seq = 0;

  constructor(
    readonly self: CompanionDevice,
    private readonly transport: CompanionTransport,
    private readonly onCommand?: (cmd: Exclude<CompanionCommand, { type: "ack" }>, from: string) => boolean | void | Promise<boolean | void>,
    private readonly now: () => number = Date.now,
  ) {
    this.unsub = transport.onMessage((raw) => void this.handleRaw(raw));
  }

  /** Replace the current presence snapshot of same-account devices. */
  syncPresence(devices: readonly CompanionDevice[]) {
    const cutoff = this.now() - STALE_PEER_MS;
    this.peers.clear();
    for (const d of devices) {
      if (d.deviceId === this.self.deviceId || d.updatedAt < cutoff) continue;
      this.peers.set(d.deviceId, d);
    }
  }

  /** Currently online peer devices (TV targets sorted first when controlling from a phone). */
  listPeers(): CompanionDevice[] {
    const cutoff = this.now() - STALE_PEER_MS;
    return [...this.peers.values()]
      .filter((d) => d.updatedAt >= cutoff)
      .sort((a, b) => (a.platform === "tv" ? -1 : 1) - (b.platform === "tv" ? -1 : 1) || b.updatedAt - a.updatedAt);
  }

  /** Send a remote command to `targetDeviceId` and await its direct ack (or timeout). */
  sendCommand(
    targetDeviceId: string,
    cmd: Exclude<CompanionCommand, { type: "ack" }>,
    timeoutMs = ACK_TIMEOUT_MS,
  ): Promise<boolean> {
    const msgId = `${this.self.deviceId}-${++this.seq}`;
    const envelope: CompanionEnvelope = {
      v: 1,
      from: this.self.deviceId,
      to: targetDeviceId,
      msgId,
      ts: this.now(),
      ...cmd,
    };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(msgId);
        resolve(false);
      }, timeoutMs);
      this.pendingAcks.set(msgId, { resolve, timer });
      this.transport.send(envelope);
    });
  }

  private async handleRaw(raw: unknown) {
    const env = parseCompanionEnvelope(raw);
    if (!env || env.to !== this.self.deviceId) return;
    if (env.type === "ack") {
      const pending = this.pendingAcks.get(env.payload.msgId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(env.payload.msgId);
        pending.resolve(env.payload.ok);
      }
      return;
    }
    let ok = true;
    try {
      const res = await this.onCommand?.(env, env.from);
      if (res === false) ok = false;
    } catch {
      ok = false;
    }
    this.transport.send({
      v: 1,
      from: this.self.deviceId,
      to: env.from,
      msgId: `${this.self.deviceId}-ack-${++this.seq}`,
      ts: this.now(),
      type: "ack",
      payload: { msgId: env.msgId, ok },
    });
  }

  close() {
    this.unsub();
    for (const p of this.pendingAcks.values()) {
      clearTimeout(p.timer);
      p.resolve(false);
    }
    this.pendingAcks.clear();
  }
}
