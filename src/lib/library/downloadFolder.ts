import { useQuery } from "@tanstack/react-query";
import { call } from "../platform/bridge";
import { os } from "../platform/device";
import { queryClient } from "../net/queries";
import type { DownloadsStorage } from "./downloads";

/**
 * Where new downloads go, chosen on this device (downloads.rs keeps it beside the list, never synced).
 * Desktop: any folder, through the system's folder dialog. Android: the app's own folder on an SD card
 * (`downloads_volumes`), or back to internal storage. iOS: no choice, the app's own folder.
 * Downloads already made stay where they are.
 */

export type FolderChoice = "dialog" | "volumes" | "none";

/** How this device chooses its download folder. */
export const folderChoice = (o = os): FolderChoice => (o === "ios" ? "none" : o === "android" ? "volumes" : "dialog");

/** A removable volume's own folder for the app (Android). */
export interface DownloadVolume {
  path: string;
  label: string;
}

export function useDownloadVolumes(enabled: boolean) {
  return useQuery({ queryKey: ["downloads", "volumes"], queryFn: () => call<DownloadVolume[]>("downloads_volumes"), enabled, staleTime: 60_000 });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: ["downloads"] });

/** The system's folder dialog (desktop); null when cancelled. Rejects with why a folder can't be used. */
export async function pickDownloadFolder(): Promise<DownloadsStorage | null> {
  const storage = await call<DownloadsStorage | null>("downloads_pick_folder");
  if (storage) await refresh();
  return storage;
}

/** One of the device's volumes (Android), or null: back to the default folder. */
export async function setDownloadFolder(dir: string | null): Promise<DownloadsStorage> {
  const storage = await call<DownloadsStorage>("downloads_set_folder", { dir });
  await refresh();
  return storage;
}
