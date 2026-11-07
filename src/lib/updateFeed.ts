import { isRecord, str } from "./parse";

/** What update feeds hold, apart from the updater (lib/updater.ts): version order and a dev feed's kept builds. */

/** Semver order: `0.18.1-dev.57` comes after 0.18.0 and before 0.18.1; pre-release parts compare by number. */
export function compareVersions(a: string, b: string) {
  const split = (v: string) => {
    const [core, pre] = v.split(/-(.*)/s);
    return { core: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split(".") : [] };
  };
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d) return Math.sign(d);
  }
  // A pre-release sorts before the version itself.
  if (!pa.pre.length || !pb.pre.length) return Math.sign(pb.pre.length - pa.pre.length);
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Math.sign(Number(x) - Number(y));
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** One of the builds the "Dev build" entry keeps (scripts/devChannel.ts writes them). */
export interface DevBuild {
  build: number;
  version: string;
  commit: string;
  date: string;
  title: string;
}

/** The builds a dev feed lists, newest first; anything malformed is left out. */
export function parseDevBuilds(feed: unknown): DevBuild[] {
  const list = isRecord(feed) && Array.isArray(feed.builds) ? feed.builds : [];
  return list
    .filter(isRecord)
    .flatMap((b) => {
      const version = str(b.version);
      const commit = str(b.commit);
      if (typeof b.build !== "number" || !Number.isInteger(b.build) || b.build < 1 || !version || !commit) return [];
      return [{ build: b.build, version, commit, date: str(b.date) ?? "", title: str(b.title) ?? "" }];
    })
    .sort((a, b) => b.build - a.build);
}
