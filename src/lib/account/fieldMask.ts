import { stable } from "./settingsDoc";

/**
 * Explicit FieldMask mutation patches (Netflix #454):
 *
 * - Keys in `mask` present in `patch` are updated to `patch[key]`.
 * - Keys in `mask` omitted from `patch` explicitly reset to `defaults[key]`.
 * - Keys outside `mask` are NEVER touched — allowing lightweight clients (Apple TV,
 *   older mobile builds) to safely edit a setting without risking wiping newer desktop keys.
 */

export interface FieldMaskPatch<T extends Record<string, unknown> = Record<string, unknown>> {
  mask: string[];
  patch: Partial<T>;
}

/** Build a minimal explicit FieldMaskPatch capturing every difference from `before` to `after`. */
export function createFieldMaskPatch<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  defaults: T,
  allowedKeys?: ReadonlySet<string>,
): FieldMaskPatch<T> {
  const mask: string[] = [];
  const patch: Partial<T> = {};
  for (const key of Object.keys(after)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    const nextVal = after[key as keyof T];
    if (stable(before[key]) === stable(nextVal)) continue;
    mask.push(key);
    if (nextVal !== undefined && stable(nextVal) !== stable(defaults[key])) {
      patch[key as keyof T] = nextVal;
    }
  }
  return { mask, patch };
}

/**
 * Apply an explicit FieldMaskPatch to `current`, preserving every key outside `update.mask`
 * (including unknown future keys!) and resetting masked-but-omitted keys to `defaults`.
 */
export function applyFieldMask<T extends Record<string, unknown>>(
  current: T,
  defaults: Partial<T>,
  update: FieldMaskPatch<T>,
): T {
  const out: Record<string, unknown> = { ...current };
  for (const key of update.mask) {
    if (key in update.patch && update.patch[key as keyof T] !== undefined) {
      out[key] = update.patch[key as keyof T];
    } else if (key in defaults) {
      out[key] = defaults[key as keyof T];
    } else {
      delete out[key];
    }
  }
  return out as T;
}

/** Compose two sequential FieldMaskPatches (`first` followed by `second`) into a single patch. */
export function mergeFieldMasks<T extends Record<string, unknown>>(
  first: FieldMaskPatch<T>,
  second: FieldMaskPatch<T>,
): FieldMaskPatch<T> {
  const maskSet = new Set([...first.mask, ...second.mask]);
  const patch: Record<string, unknown> = { ...first.patch };
  for (const key of second.mask) {
    if (key in second.patch && second.patch[key as keyof T] !== undefined) {
      patch[key] = second.patch[key as keyof T];
    } else {
      delete patch[key];
    }
  }
  return { mask: [...maskSet], patch: patch as Partial<T> };
}
