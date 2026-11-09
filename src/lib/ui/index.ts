// Hooks and helpers for the DOM: the art gate (logos wait for their art), sheet detents, the Escape/Back stack (dismiss, layer, the system Back), lazy screens, form factor, the wait for a title's logo before its name, the miss margin around panels, the on-screen keyboard, motion, viewport, fold snapping, score tones, title logo contrast.
// Its public surface: code outside src/lib imports this folder, code inside src/lib imports the file.

export * from "./artGate";
export * from "./cardIntent";
export * from "./detents";
export * from "./dismiss";
export * from "./formFactor";
export * from "./handFocus";
export * from "./inputModality";
export * from "./keyboard";
export * from "./layer";
export * from "./lazy";
export * from "./logoContrast";
export * from "./missMargin";
export * from "./nameWait";
export * from "./motion";
export * from "./pageDrag";
export * from "./pageFocus";
export * from "./pageMotion";
export * from "./presence";
export * from "./reducedMotion";
export * from "./score";
export * from "./shelfScroll";
export * from "./systemBack";
export * from "./useFoldSnap";
export * from "./viewport";
