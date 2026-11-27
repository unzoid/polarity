import { render } from "solid-js/web";
import "../styles.css";
import { Layout } from "../components/Layout";
import { Hero } from "../components/Hero";
import { Showcase } from "../components/Showcase";
import { Features } from "../components/Features";
import { Faq } from "../components/Faq";
import { reveal } from "../lib/reveal";
import { DownloadButton, ReleaseNote } from "../components/Download";
import { Footnotes } from "../components/Footnotes";
import { OpenSource } from "../components/OpenSource";
import { Flutes } from "../components/Flutes";
import { Smooth } from "../components/Smooth";

function Home() {
  return (
    <Layout>
      <Hero />
      <Showcase />
      <Features />
      <OpenSource />
      <Faq />
      <section ref={reveal} class="reveal mx-auto mt-24 max-w-[1200px] px-2 sm:mt-32 sm:px-8">
        {/* Rings rise from below the card, like a horizon. */}
        <Smooth radius={28} class="text-center">
          <Flutes shape="rings" count={5} origin={[0.5, 1.2]} drift={0.04} followPointer={false} class="absolute inset-0" />
          <div class="relative flex flex-col items-center px-6 py-20 sm:py-28">
            <h2 class="text-headline">Download Polarity</h2>
            <div class="mt-10 flex flex-col items-center gap-4">
              <DownloadButton />
              <ReleaseNote />
            </div>
          </div>
        </Smooth>
      </section>
      <Footnotes />
    </Layout>
  );
}

render(() => <Home />, document.getElementById("root")!);
