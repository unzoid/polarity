import { afterAll, afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSource } from "../../src/components/player/useSource";
import type { StreamsResult } from "../../src/lib/types";
import { render } from "./render";

// The saved position can't be read: the player starts from the beginning instead of searching forever.

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

const film = "https://media.example.com/film.mkv";
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

let asked = 0;
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: { stream?: { url: string } }) => {
    if (cmd === "streams") {
      asked++;
      return one;
    }
    if (cmd === "progress_for") throw new Error("progress lookup failed");
    if (cmd === "resolve_stream") return { kind: "url", url: args.stream!.url };
    return null;
  },
};
afterAll(() => void delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
afterEach(() => {
  asked = 0;
});

type Source = ReturnType<typeof useSource>;
const noLog = () => {};

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

test("when the saved position can't be read the source still plays", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { out, unmount } = await play(qc);
  expect(out.source!.state.status).not.toBe("searching");
  expect(out.source!.state).toMatchObject({ status: "ready", url: film });
  expect(asked).toBe(1);
  await unmount();
});
