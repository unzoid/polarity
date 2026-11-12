import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { app as api, setGitHubToken } from "./app";

// Cloudflare Worker entry: the same /api routes the Vite dev server mounts.
const app = new Elysia({ adapter: CloudflareAdapter }).use(api).compile();

export default {
  // GITHUB_TOKEN is a Worker secret (`wrangler secret put GITHUB_TOKEN`); see server/app.ts.
  fetch(request: Request, env: { GITHUB_TOKEN?: string }) {
    setGitHubToken(env.GITHUB_TOKEN);
    return app.fetch(request);
  },
};
