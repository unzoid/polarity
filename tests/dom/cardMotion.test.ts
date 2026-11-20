import { expect, test } from "bun:test";
import { CARD_CLOSE_MS, CARD_OPEN_MS, cardGeometry, playCardRelease } from "../../src/lib/ui/cardMotion";

test("cardGeometry uses uniform scale and exact aspect clip-path so cards never squish vertically", () => {
  // Portrait hero card on iPhone 16 Pro (402x874)
  const hero = cardGeometry({ x: 24, y: 112, w: 354, h: 524, src: "https://media.example.com/poster.jpg", radius: 14 }, 402, 874);
  expect(hero.sEnd).toBeCloseTo(354 / 402, 4);
  expect(hero.mediaW * hero.sEnd).toBeCloseTo(354, 1);
  expect(hero.mediaH * hero.sEnd).toBeCloseTo(524, 1);
  expect(hero.clipR).toBe(0);
  expect(hero.clipB).toBeGreaterThan(200);
  expect(hero.cardRadius).toBe(14);

  // Portrait shelf poster card (112x168)
  const poster = cardGeometry({ x: 16, y: 540, w: 112, h: 168, src: "https://media.example.com/poster.jpg", radius: 8 }, 402, 874);
  expect(poster.sEnd).toBeCloseTo(112 / 402, 4);
  expect(poster.mediaW * poster.sEnd).toBeCloseTo(112, 1);
  expect(poster.mediaH * poster.sEnd).toBeCloseTo(168, 1);
  expect(poster.clipR).toBe(0);
  expect(poster.cardRadius).toBe(8);

  // Landscape orientation: poster narrower than landscape viewport clips on the right instead of bottom
  const landscape = cardGeometry({ x: 40, y: 120, w: 120, h: 180, src: "https://media.example.com/poster.jpg", radius: 8 }, 874, 402);
  expect(landscape.sEnd).toBeCloseTo(180 / 402, 4);
  expect(landscape.mediaW * landscape.sEnd).toBeCloseTo(120, 1);
  expect(landscape.mediaH * landscape.sEnd).toBeCloseTo(180, 1);
  expect(landscape.clipB).toBe(0);
  expect(landscape.clipR).toBeGreaterThan(500);
});

test("card motion durations match Netflix 60fps open/close and release speeds up on fast flicks", () => {
  expect(CARD_OPEN_MS).toBe(460);
  expect(CARD_CLOSE_MS).toBe(380);

  const page = document.createElement("section");
  const card = { x: 24, y: 112, w: 120, h: 180, src: "https://media.example.com/poster.jpg", radius: 8 };
  const slow = playCardRelease({
    page,
    scrim: null,
    ghost: null,
    card,
    width: 402,
    height: 874,
    from: { x: 108, y: 40, scale: 0.88, radius: 38, scrimOpacity: 0.46 },
    velocity: 0,
  });
  const flick = playCardRelease({
    page,
    scrim: null,
    ghost: null,
    card,
    width: 402,
    height: 874,
    from: { x: 108, y: 40, scale: 0.88, radius: 38, scrimOpacity: 0.46 },
    velocity: 1400,
  });
  expect(flick.ms).toBeLessThan(slow.ms);
  expect(flick.ms).toBeGreaterThanOrEqual(240);
  expect(slow.ms).toBeLessThanOrEqual(CARD_CLOSE_MS);
});
