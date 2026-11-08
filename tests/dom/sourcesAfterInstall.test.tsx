import { afterAll, afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSource } from "../../src/components/player/useSource";
import { keys } from "../../src/lib/net";
import type { StreamsResult } from "../../src/lib/types";
import { render } from "./render";

// #375: "No sources found" with no add-ons, then an add-on installed: the same episode asks the add-ons again.

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

const film = "https://media.example.com/film.mkv";
const none: StreamsResult = { streams: [], failed: [], asked: [], ids: ["tt0000001:1:1"] };
const one: StreamsResult = {
  streams: [
    {
      stream: { url: film },
      addon: "Example Add-on",
      quality: { resolution: 1080, hdr: false, dolbyVision: false, lowQualitySource: false, direct: true, languages: [], tags: [] },
      label: "1080p",
    },
  ],
  failed: [],
  asked: ["Example Add-on"],
  ids: ["tt0000001:1:1"],
};

/** The app: `answer` is what the add-ons give; each streams request is counted. */
let answer: StreamsResult = none;
let asked = 0;
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: { stream?: { url: string } }) => {
    if (cmd === "streams") {
      asked++;
      return answer;
    }
    if (cmd === "progress_for") return [];
    if (cmd === "resolve_stream") return { kind: "url", url: args.stream!.url };
    return null;
  },
};
afterAll(() => void delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
afterEach(() => {
  answer = none;
  asked = 0;
});

type Source = ReturnType<typeof useSource>;
/** The start log, kept the same between renders as the player's is. */
const noLog = () => {};

/** Opens the player's source choice for one episode, as pressing it does; unmount = leaving the player. */
async function play(qc: QueryClient) {
  const out: { source?: Source } = {};
  function Probe() {
    out.source = useSource("series", "tt0000001", "tt0000001:1:1", undefined, undefined, noLog);
    return null;
  }
  const view = await render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  await settle();
  return { out, unmount: view.unmount };
}

test("with no add-ons the episode finds nothing, and once one is installed the same episode asks again and plays (#375)", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = await play(qc);
  expect(first.out.source!.state).toEqual({ status: "failed", reason: "No sources found. Install a stream add-on in Settings.", settings: "addons" });
  await first.unmount();
  expect(asked).toBe(1);

  // An add-on installed: the Add-ons page invalidates the source answers.
  answer = one;
  await act(async () => void qc.invalidateQueries({ queryKey: keys.streamsAll }));
  const again = await play(qc);
  expect(asked).toBe(2);
  expect(again.out.source!.state).toMatchObject({ status: "ready", url: film });
  await again.unmount();
});

test("an answer with no sources isn't kept: the next play asks again even with nothing invalidated", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = await play(qc);
  expect(first.out.source!.state.status).toBe("failed");
  await first.unmount();
  answer = one;
  const again = await play(qc);
  expect(asked).toBe(2);
  expect(again.out.source!.state).toMatchObject({ status: "ready", url: film });
  await again.unmount();
});

test("Try Again on the error screen asks the add-ons again and plays what they find now", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { out, unmount } = await play(qc);
  expect(out.source!.state.status).toBe("failed");
  answer = one;
  await act(async () => out.source!.retry());
  await settle();
  expect(asked).toBe(2);
  expect(out.source!.state).toMatchObject({ status: "ready", url: film });
  await unmount();
});
