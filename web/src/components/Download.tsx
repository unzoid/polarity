import { Show } from "solid-js";
import { REPO_URL } from "./GitHub";
import { DOWNLOAD_PAGE, PLATFORM_NAMES, platform, primaryInstaller, release } from "../lib/release";

/**
 * Downloads straight away when the visitor's platform has a build;
 * otherwise it goes to the download page, which lists what exists.
 */
export function DownloadButton(props: { size?: "sm" | "lg" }) {
  const big = () => props.size !== "sm";
  const installer = primaryInstaller;
  const label = () => {
    if (!big()) return "Download";
    return installer() && platform ? `Download for ${PLATFORM_NAMES[platform]}` : "Download Polarity";
  };
  return (
    <a href={installer()?.url ?? DOWNLOAD_PAGE} class="btn btn-solid" classList={{ "btn-lg": big(), "btn-sm": !big() }}>
      <Show when={platform === "windows" && installer()}>
        <WindowsGlyph class={big() ? "size-4" : "size-3"} />
      </Show>
      {label()}
    </a>
  );
}

/** "Free and open source (MIT) · Version 0.17.0 · Other platforms" next to a download button. */
export function ReleaseNote(props: { class?: string }) {
  return (
    <p class={`text-base font-semibold ${props.class ?? ""}`}>
      Free and open source (
      <a href={`${REPO_URL}/blob/master/LICENSE`} class="link">
        MIT
      </a>
      )
      <Show when={release()?.version}>
        {(version) => (
          <>
            {" · "}
            <a href={release()!.notes} class="link">
              Version {version()}
            </a>
          </>
        )}
      </Show>
      {" · "}
      <a href={DOWNLOAD_PAGE} class="link">
        Other platforms
      </a>
    </p>
  );
}

export function WindowsGlyph(props: { class?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class={props.class}>
      <path d="M0 2.3 6.5 1.4v6.2H0zM7.3 1.3 16 0v7.6H7.3zM0 8.4h6.5v6.2L0 13.7zM7.3 8.4H16V16l-8.7-1.2z" />
    </svg>
  );
}
