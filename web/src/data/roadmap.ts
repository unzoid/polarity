/**
 * The public roadmap. Edit by hand: move an item between groups by changing
 * its `status`. Items link to their GitHub issue when `issue` is set.
 */
export type Status = "beta" | "progress" | "planned";

export type RoadmapItem = { title: string; body: string; status: Status; issue?: number };

export const GROUPS: { status: Status; title: string; body: string; badge: string }[] = [
  { status: "beta", title: "On Beta", body: "Ready to try in a pre-release build.", badge: "On Beta" },
  { status: "progress", title: "In Progress", body: "Being worked on now.", badge: "In progress" },
  { status: "planned", title: "Planned", body: "Planned for later.", badge: "Planned" },
];

export const ITEMS: RoadmapItem[] = [
  { status: "progress", title: "Android TV", body: "Polarity on the TV itself, in TV mode, with the remote's arrow keys." },
  { status: "progress", title: "Apple TV", body: "Polarity on Apple TV, in TV mode." },
];
