import { expect, test } from "bun:test";
import { connectionCode, databaseProblem, loadDevDatabase, parseConnectionCode, devDatabase } from "../src/lib/account/devDatabase";
import type { KeyStorage } from "../src/lib/platform/keychain";
import { buildLabel, channelOf } from "../src/lib/platform/build";
import { parseDevBuilds } from "../src/lib/updateFeed";

const db = { url: "https://abcdefghijklmnopqrst.supabase.co", key: "sb_publishable_xxx" };
const jwt = (payload: object) => `xxx.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.xxx`;

function memory(values: Record<string, string> = {}): KeyStorage {
  const m = new Map(Object.entries(values));
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
    peek: (k) => m.get(k),
  };
}

test("a connection code carries the address and publishable key", () => {
  const code = connectionCode(db);
  expect(code).toStartWith("polarity-db:");
  expect(parseConnectionCode(code)).toEqual(db);
  // Pasted with line breaks or spaces around it.
  expect(parseConnectionCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `)).toEqual(db);
  expect(parseConnectionCode("polarity-db:abc")).toHaveProperty("problem");
  expect(parseConnectionCode(db.url)).toHaveProperty("problem");
});

test("only Supabase addresses and publishable keys are taken", () => {
  expect(databaseProblem(db)).toBeNull();
  expect(databaseProblem({ ...db, key: jwt({ role: "anon" }) })).toBeNull();
  expect(databaseProblem({ ...db, key: "sb_secret_xxx" })).toMatch(/secret key/);
  expect(databaseProblem({ ...db, key: jwt({ role: "service_role" }) })).toMatch(/service role/);
  expect(databaseProblem({ ...db, key: "TOKEN" })).toMatch(/publishable/);
  expect(databaseProblem({ ...db, url: "http://abcdefghijklmnopqrst.supabase.co" })).not.toBeNull();
  expect(databaseProblem({ ...db, url: "https://db.example.com" })).not.toBeNull();
  expect(databaseProblem({ ...db, url: "https://abcdefghijklmnopqrst.supabase.co/rest" })).not.toBeNull();
  expect(parseConnectionCode(connectionCode({ ...db, key: "sb_secret_xxx" }))).toHaveProperty("problem");
});

test("only dev builds read a stored connection", async () => {
  const storage = memory({ "polar.devdb": connectionCode(db) });
  expect(await loadDevDatabase(storage, "release")).toBeNull();
  expect(await loadDevDatabase(storage, "local")).toBeNull();
  expect(await loadDevDatabase(storage, "dev")).toEqual(db);
  expect(devDatabase()).toEqual(db);
  expect(await loadDevDatabase(memory(), "dev")).toBeNull();
  expect(await loadDevDatabase(memory({ "polar.devdb": "polarity-db:broken" }), "dev")).toBeNull();
  expect(devDatabase()).toBeNull();
});

test("builds are named by channel", () => {
  expect(channelOf("dev")).toBe("dev");
  expect(channelOf("release")).toBe("release");
  expect(channelOf(undefined)).toBe("local");
  expect(channelOf("nightly")).toBe("local");
  expect(buildLabel("dev", "0.18.1-dev.57", "3f9c2a1")).toBe("Dev build 3f9c2a1 (0.18.1-dev.57)");
  expect(buildLabel("dev", "0.18.1-dev.57", "")).toBe("Dev build 0.18.1-dev.57");
  expect(buildLabel("local", "0.18.0", "3f9c2a1")).toBe("Local build 3f9c2a1");
  expect(buildLabel("release", "0.18.0", "3f9c2a1")).toBe("0.18.0");
});

test("the kept builds are read from the dev feed, newest first", () => {
  const feed = {
    version: "0.18.1-dev.57",
    builds: [
      { build: 55, version: "0.18.1-dev.55", commit: "abc55", date: "2026-11-06T10:00:00Z", title: "PR 55" },
      { build: 57, version: "0.18.1-dev.57", commit: "abc57", date: "2026-11-07T10:00:00Z", title: "PR 57" },
      { build: "56", version: "0.18.1-dev.56", commit: "abc56" },
      { build: 54, version: "0.18.1-dev.54" },
      null,
    ],
  };
  expect(parseDevBuilds(feed).map((b) => b.build)).toEqual([57, 55]);
  expect(parseDevBuilds({})).toEqual([]);
  expect(parseDevBuilds(null)).toEqual([]);
});
