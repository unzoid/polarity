import { createEffect, For, onCleanup, onMount } from "solid-js";

/**
 * Segmented pill toggle whose selected pill slides between items.
 * The buttons stay plain; an aria-hidden copy drawn as the selected state is
 * clipped to the selected button (see `.seg-active` in styles.css). The clip
 * follows the button's box, so it also works when the row wraps on phones.
 */
export function Seg(props: { label: string; items: string[]; value: number; onChange: (i: number) => void }) {
  let root!: HTMLDivElement;
  let copy!: HTMLDivElement;
  const buttons: HTMLButtonElement[] = [];

  const place = () => {
    const b = buttons[props.value];
    if (!b) return;
    const right = root.clientWidth - b.offsetLeft - b.offsetWidth;
    const bottom = root.clientHeight - b.offsetTop - b.offsetHeight;
    copy.style.setProperty("--clip", `inset(${b.offsetTop}px ${right}px ${bottom}px ${b.offsetLeft}px round 999px)`);
  };

  createEffect(place);
  onMount(() => {
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div ref={root} class="seg" role="group" aria-label={props.label}>
      <For each={props.items}>
        {(item, i) => (
          <button
            ref={(el) => (buttons[i()] = el)}
            type="button"
            class="seg-item"
            aria-pressed={i() === props.value}
            onClick={() => {
              // The first position lands instantly; from the first pick on,
              // changes slide (the attribute and the new clip apply together).
              copy.setAttribute("data-ready", "");
              props.onChange(i());
            }}
          >
            {item}
          </button>
        )}
      </For>
      <div ref={copy} class="seg-active" aria-hidden="true">
        <For each={props.items}>{(item) => <span class="seg-item">{item}</span>}</For>
      </div>
    </div>
  );
}
