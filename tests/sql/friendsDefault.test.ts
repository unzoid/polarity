// supabase/migrations/20261112000000_friends_on_by_default.sql in PGlite (#428): a profile that never
// turned Friends on or off gets it on once, with what it watches hidden; one that turned it off keeps
// it off; profiles from before the migration keep what they have. The tests share one database.
import { beforeAll, describe, expect, test } from "bun:test";
import { as, migrations, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const MIGRATION = "20261112000000_friends_on_by_default.sql";
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const OLD_OFF = "00000000-0000-0000-0000-0000000000a1";
const OLD_ON = "00000000-0000-0000-0000-0000000000a2";
const NEW = "00000000-0000-0000-0000-0000000000a3";
const NEW_OFF = "00000000-0000-0000-0000-0000000000a4";
const OTHER = "00000000-0000-0000-0000-0000000000b1";

let db: Db;
const one = async <T,>(sql: string) => (await db.query<{ v: T }>(`select ${sql} as v`)).rows[0].v;
const settings = async (p: string) => (await db.query(`select show_online, show_watching, joinable from friend_settings('${p}')`)).rows;

beforeAll(async () => {
  db = await supabaseDb();
  const all = migrations();
  expect(all).toContain(MIGRATION);
  const before = all.slice(0, all.indexOf(MIGRATION));
  for (const f of before) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users(id) values ('${A}'), ('${B}');
insert into profiles(id, user_id, name, avatar) values ('${OLD_OFF}','${A}','Ada','blue'), ('${OLD_ON}','${A}','Ari','green');
grant all on all tables in schema public to authenticated;`);
  await as(db, A);
  await db.exec(`select friend_on('${OLD_ON}')`);
  await as(db, null);
  for (const f of all.slice(before.length)) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into profiles(id, user_id, name, avatar) values ('${NEW}','${A}','Ann','red'), ('${NEW_OFF}','${A}','Abe','red'),
  ('${OTHER}','${B}','Bo','green');`);
}, 30_000);

describe("Friends on by default", () => {
  test("a new profile gets it on once: online and joinable, what it watches hidden", async () => {
    await as(db, A);
    expect(await one<string | null>(`friend_default_on('${NEW}')`)).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(await settings(NEW)).toEqual([{ show_online: true, show_watching: false, joinable: true }]);
    expect(await one<string | null>(`friend_default_on('${NEW}')`)).toBeNull();
  });

  test("a profile that turned it off keeps it off", async () => {
    await as(db, A);
    await db.exec(`select friend_off('${NEW}')`);
    expect(await one<string | null>(`friend_default_on('${NEW}')`)).toBeNull();
    expect(await settings(NEW)).toEqual([]);
    // Off before the app ever asked counts as a choice too.
    await db.exec(`select friend_off('${NEW_OFF}')`);
    expect(await one<string | null>(`friend_default_on('${NEW_OFF}')`)).toBeNull();
    expect(await settings(NEW_OFF)).toEqual([]);
  });

  test("profiles from before the migration keep what they have", async () => {
    await as(db, A);
    expect(await one<string | null>(`friend_default_on('${OLD_OFF}')`)).toBeNull();
    expect(await settings(OLD_OFF)).toEqual([]);
    expect(await one<string | null>(`friend_default_on('${OLD_ON}')`)).toBeNull();
    expect(await settings(OLD_ON)).toEqual([{ show_online: true, show_watching: true, joinable: true }]);
  });

  test("only for the caller's own profiles, and never for someone signed out", async () => {
    await as(db, A);
    await expect(db.query(`select friend_default_on('${OTHER}')`)).rejects.toThrow(/not_your_profile/);
    await as(db, null);
    await expect(db.query(`select friend_default_on('${OTHER}')`)).rejects.toThrow();
    await as(db, B);
    expect(await settings(OTHER)).toEqual([]);
  });

  test("the list of who chose is closed to callers", async () => {
    await as(db, A);
    await expect(db.query(`select * from public.friend_chosen`)).resolves.toMatchObject({ rows: [] });
  });
});
