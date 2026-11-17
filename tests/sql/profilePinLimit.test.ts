// A profile's PIN and viewing limit (supabase/migrations/20261115000000_profile_pin_and_limit.sql) in PGlite:
// rows made before it get no PIN and no limit, what an older app reads and writes still works, the checks hold
// the hash's shape and the limit's range, and row-level security still keeps each account to its own profiles.
// The tests share one database and run in order.
import { beforeAll, expect, test } from "bun:test";
import { hashPin } from "../../src/lib/account/pin";
import { lockFromRow, lockToRow } from "../../src/lib/account/profileLock";
import { as, fails, migrations, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const PA = "00000000-0000-0000-0000-0000000000a1";
const PB = "00000000-0000-0000-0000-0000000000b1";

let db: Db;
const lockOf = async (id: string) =>
  (await db.query<{ pin_hash: string | null; viewing_limit: number | null; viewing_hide_unrated: boolean }>(
    `select pin_hash, viewing_limit, viewing_hide_unrated from profiles where id = '${id}'`,
  )).rows[0];

beforeAll(async () => {
  db = await supabaseDb();
  const files = migrations();
  const mine = files.find((f) => f.includes("profile_pin_and_limit"))!;
  for (const f of files.filter((f) => f < mine)) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);
  await as(db, A);
  await db.exec(`insert into profiles(id, name) values ('${PA}', 'Ada')`);
  await as(db, B);
  await db.exec(`insert into profiles(id, name) values ('${PB}', 'Ben')`);
  await as(db, null);
  for (const f of files.filter((f) => f >= mine)) await db.exec(sqlFile(`migrations/${f}`));
  await as(db, A);
}, 30_000);

test("a profile made before the migration has no PIN and no limit", async () => {
  const row = await lockOf(PA);
  expect(row).toEqual({ pin_hash: null, viewing_limit: null, viewing_hide_unrated: false });
  expect(lockFromRow(row)).toEqual({ pin: null, viewingLimit: null, hideUnrated: false });
});

test("an older app's reads and writes still go", async () => {
  await db.exec(`update profiles set name = 'Ada L', avatar = 'fox' where id = '${PA}'`);
  const { rows } = await db.query<{ name: string }>(`select id, name, avatar, position from profiles order by position`);
  expect(rows.map((r) => r.name)).toEqual(["Ada L"]);
  expect(await fails(db, `insert into profiles(name) values ('Cy')`)).toBe(false);
});

test("a PIN's hash and a limit are kept as the app writes them", async () => {
  const pin = await hashPin("1234", { iterations: 1000 });
  const row = lockToRow({ pin, viewingLimit: 12, hideUnrated: true });
  await db.exec(
    `update profiles set pin_hash = '${row.pin_hash}', viewing_limit = ${row.viewing_limit}, viewing_hide_unrated = ${row.viewing_hide_unrated} where id = '${PA}'`,
  );
  expect(lockFromRow(await lockOf(PA))).toEqual({ pin, viewingLimit: 12, hideUnrated: true });
  // The full-length hash this version makes fits too.
  const full = await hashPin("0000", { iterations: 600_000 });
  expect(await fails(db, `update profiles set pin_hash = '${full}' where id = '${PA}'`)).toBe(false);
});

test("the checks refuse what isn't a hash, and limits outside 1 to 21", async () => {
  expect(await fails(db, `update profiles set pin_hash = '1234' where id = '${PA}'`)).toBe(true);
  expect(await fails(db, `update profiles set pin_hash = 'pbkdf2-sha256$1000$a b$c' where id = '${PA}'`)).toBe(true);
  expect(await fails(db, `update profiles set pin_hash = '${"x".repeat(500)}' where id = '${PA}'`)).toBe(true);
  expect(await fails(db, `update profiles set viewing_limit = 0 where id = '${PA}'`)).toBe(true);
  expect(await fails(db, `update profiles set viewing_limit = 22 where id = '${PA}'`)).toBe(true);
  expect(await fails(db, `update profiles set viewing_limit = null, pin_hash = null where id = '${PA}'`)).toBe(false);
});

test("row-level security is unchanged: another account neither reads nor changes the PIN or limit", async () => {
  await db.exec(`update profiles set viewing_limit = 9 where id = '${PA}'`);
  await as(db, B);
  const seen = await db.query(`select pin_hash, viewing_limit from profiles where id = '${PA}'`);
  expect(seen.rows).toHaveLength(0);
  await db.exec(`update profiles set viewing_limit = null, pin_hash = null where id = '${PA}'`);
  await as(db, A);
  expect((await lockOf(PA)).viewing_limit).toBe(9);
  const { rows } = await db.query<{ policyname: string; qual: string }>(
    `select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'profiles'`,
  );
  expect(rows.map((r) => r.policyname)).toEqual(["own profiles"]);
});
