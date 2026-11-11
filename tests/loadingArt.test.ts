import { expect, test } from "bun:test";
import { loadingArt } from "../src/lib/playback/loadingArt";

const meta = {
  logo: "https://media.example.com/title-logo.png",
  logos: ["https://media.example.com/title-logo.png"],
  background: "https://media.example.com/bg.jpg",
};
const page = {
  logo: "https://media.example.com/franchise-logo.png",
  logos: ["https://media.example.com/franchise-logo.png"],
  background: "https://media.example.com/franchise.jpg",
};

test("an anime episode's loading screen takes its page's art, the franchise's when grouped (#391)", () => {
  expect(loadingArt(meta, false, page, true)).toEqual({ ...page, pending: false });
  // Until the page's art is known nothing is drawn, not even the title's.
  expect(loadingArt(meta, false, undefined, true)).toEqual({ pending: true });
  // The page couldn't be asked: the title's art, as its title page shows it.
  expect(loadingArt(meta, false, null, true)).toEqual({ ...meta, pending: false });
});

test("films, series and anime not lined up here take the title's art (#391)", () => {
  expect(loadingArt(meta, false, undefined, false)).toEqual({ ...meta, pending: false });
  expect(loadingArt(undefined, true, undefined, false)).toEqual({ logo: undefined, logos: undefined, background: undefined, pending: true });
});
