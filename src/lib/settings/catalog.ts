// Settings schema, search index, credits and legal links — only loaded by Settings screens and TV Settings,
// keeping ~55 KB of schema definitions out of the app's initial boot bundle.
export * from "./credits";
export * from "./legal";
export * from "./schema";
export * from "./searchIndex";
export { useSetting } from "./useSetting";
