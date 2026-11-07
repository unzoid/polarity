// A connection code for a dev build's database (src/lib/account/devDatabase.ts, docs/dev-channel.md):
// pasted in a dev build's Settings → Advanced → Database. It holds the project's address and its
// publishable key; share it with the team privately.
//
//   bun scripts/devDatabaseCode.ts https://<project>.supabase.co <publishable key>
import { connectionCode, databaseProblem } from "../src/lib/account/devDatabase";

if (import.meta.main) {
  const [url = "", key = ""] = process.argv.slice(2);
  const db = { url: url.replace(/\/+$/, ""), key };
  const problem = databaseProblem(db);
  if (problem) {
    console.error(problem);
    console.error("Usage: bun scripts/devDatabaseCode.ts https://<project>.supabase.co <publishable key>");
    process.exit(1);
  }
  console.log(connectionCode(db));
}
