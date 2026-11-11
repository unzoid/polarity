import { render } from "solid-js/web";
import "../styles.css";
import { Layout } from "../components/Layout";
import { Hero } from "../components/Hero";
import { Showcase } from "../components/Showcase";
import { Features } from "../components/Features";
import { Faq } from "../components/Faq";
import { DownloadButton, ReleaseNote } from "../components/Download";
import { Footnotes } from "../components/Footnotes";
import { OpenSource } from "../components/OpenSource";

/** Closing call to action, at the top of the dark footer band. */
function End() {
  return (
    <>
      <section id="download" class="scroll-mt-0">
        <h2 class="text-display max-w-[9em]">Download Polarity</h2>
        <div class="mt-9 flex flex-wrap items-center gap-x-[18px] gap-y-3">
          <DownloadButton />
          <ReleaseNote />
        </div>
      </section>
      <Footnotes />
    </>
  );
}

function Home() {
  return (
    <Layout end={<End />}>
      <Hero />
      <Showcase />
      <Features />
      <OpenSource />
      <Faq />
    </Layout>
  );
}

render(() => <Home />, document.getElementById("root")!);
