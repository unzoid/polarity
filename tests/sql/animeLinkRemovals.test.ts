// Anime link removals (supabase/migrations/20261111000000_anime_link_removals.sql, #335) in PGlite:
// rows written before it read as links, a removal replaces its link and a later link replaces the
// removal, newest first as ever. The tests share one database and run in order.
import { beforeAll, expect, test } from "bun:test";
import { toLinkRow } from "../../src/lib/account/supabase";
import type { AnimeLink } from "../../src/lib/library/identity";
import { as, migrations, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const A = "00000000-0000-0000-0000-00000000000a";
const PA = "00000000-0000-0000-0000-0000000000a1";
const T = 1_762_000_000_000;

let db: Db;
const upsert = (l: AnimeLink) => {
  const r = toLinkRow(PA, l);
  return db.exec(`insert into anime_links(profile_id, anilist, canonical, mal, kitsu, deleted, updated_at)
    values ('${r.profile_id}', ${r.anilist}, '${r.canonical}', ${r.mal ?? "null"}, ${r.kitsu ?? "null"}, ${r.deleted}, ${r.updated_at})
    on conflict (profile_id, anilist) do update set canonical = excluded.canonical, mal = excluded.mal, kitsu = excluded.kitsu,
      deleted = excluded.deleted, updated_at = excluded.updated_at`);
};
const row = async () =>
  (await db.query<{ canonical: string; deleted: boolean; updated_at: string }>(`select canonical, deleted, updated_at::text from anime_links`)).rows[0];

beforeAll(async () => {
  db = await supabaseDb();
  const files = migrations();
  const removals = files.find((f) => f.includes("anime_link_removals"))!;
  for (const f of files.filter((f) => f < removals)) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users values ('${A}'); insert into profiles(id, user_id, name) values ('${PA}','${A}','A')`);
  await as(db, A);
  await db.exec(`insert into anime_links(profile_id, anilist, canonical, kitsu, updated_at) values ('${PA}', 1, 'tt0000002', 5, ${T})`);
  await as(db, null);
  for (const f of files.filter((f) => f >= removals)) await db.exec(sqlFile(`migrations/${f}`));
  await as(db, A);
}, 30_000);

test("a link written before the migration is a link", async () => {
  expect(await row()).toEqual({ canonical: "tt0000002", deleted: false, updated_at: String(T) });
});

test("a removal replaces the link, and an older write can't bring the link back", async () => {
  await upsert({ canonical: "tt0000002", anilist: 1, kitsu: 5, updatedAt: T + 10, removed: true });
  expect(await row()).toMatchObject({ deleted: true, updated_at: String(T + 10) });
  await upsert({ canonical: "tt0000002", anilist: 1, kitsu: 5, updatedAt: T + 5 });
  expect(await row()).toMatchObject({ deleted: true, updated_at: String(T + 10) });
});

test("a later link replaces the removal", async () => {
  await upsert({ canonical: "tt0000003", anilist: 1, kitsu: 5, updatedAt: T + 20 });
  expect(await row()).toEqual({ canonical: "tt0000003", deleted: false, updated_at: String(T + 20) });
});
