#!/usr/bin/env bash
# Builds the core (crates/ffi) for the Apple TV app and writes its Swift side with UniFFI.
# Runs on macOS with Xcode and rustup; elsewhere it writes only the Swift side, to check it.
#
#   scripts/apple-tv-core.sh [out dir]      default: apple-tv/Core
#
# Writes into the out dir:
#   PolarCoreFFI.xcframework    the static library for Apple TV and its simulator, with its C header
#                               and module map (macOS only)
#   PolarCore.swift             the Swift API the app calls (`Core`, `playerOptions()`, ...)
#
# Written for the bash 3.2 macOS ships, too.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
out=${1:-$root/apple-tv/Core}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$root"
target_dir=${CARGO_TARGET_DIR:-$root/target}

# The oldest tvOS the Apple TV app runs on.
export TVOS_DEPLOYMENT_TARGET=17.0
TARGETS="aarch64-apple-tvos aarch64-apple-tvos-sim"

# The Swift side, read from a build of the library for this machine: the interface is the same on
# every target.
cargo build -p polar-ffi --features bindgen --bin uniffi-bindgen --locked
cargo build -p polar-ffi --lib --locked
case "$(uname -s)" in
Darwin) host_lib="$target_dir/debug/libpolar_ffi.dylib" ;;
*) host_lib="$target_dir/debug/libpolar_ffi.so" ;;
esac
gen=$(mktemp -d)
trap 'rm -rf "$gen"' EXIT
"$target_dir/debug/uniffi-bindgen" generate --library "$host_lib" --language swift --out-dir "$gen"
cp "$gen/PolarCore.swift" "$out/"

if [ "$(uname -s)" != Darwin ]; then
	echo "Wrote $out/PolarCore.swift. The library for Apple TV needs a Mac with Xcode." >&2
	exit 0
fi

# shellcheck disable=SC2086
rustup target add $TARGETS
args=()
mkdir -p "$gen/headers"
cp "$gen/PolarCoreFFI.h" "$gen/headers/"
cp "$gen/PolarCoreFFI.modulemap" "$gen/headers/module.modulemap"
for t in $TARGETS; do
	cargo build -p polar-ffi --lib --release --locked --target "$t"
	args+=(-library "$target_dir/$t/release/libpolar_ffi.a" -headers "$gen/headers")
done
rm -rf "$out/PolarCoreFFI.xcframework"
xcodebuild -create-xcframework "${args[@]}" -output "$out/PolarCoreFFI.xcframework"
echo "Wrote $out/PolarCoreFFI.xcframework and $out/PolarCore.swift." >&2
