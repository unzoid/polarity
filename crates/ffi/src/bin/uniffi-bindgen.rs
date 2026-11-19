//! Writes the Swift side of `polar_ffi`: `scripts/apple-tv-core.sh` runs it on the built library.
fn main() {
    uniffi::uniffi_bindgen_main()
}
