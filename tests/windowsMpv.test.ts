import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mpvVersion, vendoredMpvVersion } from "../scripts/windowsMpv";

const repo = join(import.meta.dir, "..");

function checkout(crlf: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "windows-mpv-"));
  mkdirSync(join(root, "scripts"));
  for (const f of ["windows-mpv.sh", "windows-mpv.lock"]) {
    const lf = readFileSync(join(repo, "scripts", f), "utf8").replaceAll("\r\n", "\n");
    writeFileSync(join(root, "scripts", f), crlf ? lf.replaceAll("\n", "\r\n") : lf);
  }
  return root;
}

/** A working `bash` with `sha256sum`, skipping Windows' `System32\bash.exe` WSL stub when WSL isn't installed. */
function findBash(): string | undefined {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe");
    const execPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout?.trim();
    if (execPath) {
      candidates.push(
        join(execPath, "..", "..", "bin", "bash.exe"),
        join(execPath, "..", "..", "..", "bin", "bash.exe"),
        join(execPath, "..", "..", "..", "usr", "bin", "bash.exe"),
      );
    }
  }
  candidates.push("bash");
  for (const bin of candidates) {
    if (bin !== "bash" && !existsSync(bin)) continue;
    if (spawnSync(bin, ["-c", "true"], { stdio: "ignore" }).status !== 0) continue;
    if (spawnSync(bin, ["-c", "command -v sha256sum >/dev/null 2>&1"], { stdio: "ignore" }).status === 0) return bin;
  }
  return undefined;
}

describe("Windows mpv version", () => {
  test("is what CI computes, whatever the line endings", () => {
    const lf = checkout(false);
    const crlf = checkout(true);
    try {
      expect(mpvVersion(lf)).toMatch(/^[0-9a-f]{16}$/);
      expect(mpvVersion(lf)).toBe(mpvVersion(crlf));
      const bash = findBash();
      if (bash) {
        // The workflows' step, on the repository's own files.
        const ci = spawnSync(bash, ["-c", "cat scripts/windows-mpv.sh scripts/windows-mpv.lock | tr -d '\\r' | sha256sum | cut -c1-16"], {
          cwd: repo,
          encoding: "utf8",
        }).stdout.trim();
        expect(ci).toMatch(/^[0-9a-f]{16}$/);
        expect(mpvVersion(lf)).toBe(ci);
        expect(mpvVersion(crlf)).toBe(ci);
      }
    } finally {
      rmSync(lf, { recursive: true });
      rmSync(crlf, { recursive: true });
    }
  });

  test("of the vendored build only when mpv.exe and its sources are both there", () => {
    const root = checkout(false);
    const vendor = join(root, "src-tauri", "vendor");
    expect(vendoredMpvVersion(root)).toBeUndefined();
    mkdirSync(join(vendor, "mpv"), { recursive: true });
    writeFileSync(join(vendor, "mpv", "mpv.exe"), ""); // a stand-in has no VERSION
    expect(vendoredMpvVersion(root)).toBeUndefined();
    writeFileSync(join(vendor, "mpv", "VERSION"), "0123456789abcdef\n");
    expect(vendoredMpvVersion(root)).toBeUndefined();
    mkdirSync(join(vendor, "mpv-sources"));
    writeFileSync(join(vendor, "mpv-sources", "polarity-windows-mpv-sources.tar"), "");
    expect(vendoredMpvVersion(root)).toBe("0123456789abcdef");
    rmSync(root, { recursive: true });
  });
});
