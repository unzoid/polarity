//! Free space on the disk that holds a folder (the Downloads page's "112 GB free", #15). The
//! standard library can't ask, so this calls the OS: `statvfs` (libc) everywhere but Windows,
//! `GetDiskFreeSpaceExW` (windows-sys) there. Any failure is `None`, and the page leaves the
//! figure out.

use std::path::Path;

/// Minimum free bytes kept in reserve so downloads never starve OS/store writes.
pub const MIN_FREE_RESERVE_BYTES: u64 = 512 * 1024 * 1024; // 512 MiB
/// Upper bound on the percentage reserve so multi-terabyte drives with tens of GiB free aren't flagged full.
pub const MAX_RESERVE_CAP_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10 GiB
/// Maximum fraction of a disk allowed to be used before downloads pause cleanly (Netflix 95% guard).
pub const MAX_DISK_USED_RATIO: f64 = 0.95;

/// Free and total bytes on the filesystem holding a folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiskUsage {
    pub free: u64,
    pub total: u64,
}

impl DiskUsage {
    /// Fraction of the disk currently used (0.0..=1.0).
    pub fn used_ratio(self) -> f64 {
        if self.total == 0 {
            return 0.0;
        }
        let used = self.total.saturating_sub(self.free);
        (used as f64) / (self.total as f64)
    }

    /// True when the disk is below the 512 MiB safety floor, or at/above 95% full with under 10 GiB free.
    pub fn is_full(self) -> bool {
        self.free < MIN_FREE_RESERVE_BYTES
            || (self.used_ratio() >= MAX_DISK_USED_RATIO && self.free < MAX_RESERVE_CAP_BYTES)
    }
}

/// Bytes free to this user on the disk holding `dir`, or on its nearest existing parent (the
/// downloads folder is only made with the first download).
pub fn free_bytes(dir: &Path) -> Option<u64> {
    disk_usage(dir).map(|u| u.free)
}

/// Free and total bytes on the disk holding `dir`, or on its nearest existing parent.
pub fn disk_usage(dir: &Path) -> Option<DiskUsage> {
    let existing = dir.ancestors().find(|p| p.is_dir())?;
    usage(existing)
}

/// True when the disk holding `dir` is critically full (>= 95% used or < 512 MiB free).
/// Returns `false` if the OS cannot report disk space so downloads are not blocked blindly.
pub fn is_disk_full(dir: &Path) -> bool {
    disk_usage(dir).is_some_and(DiskUsage::is_full)
}

#[cfg(unix)]
fn usage(dir: &Path) -> Option<DiskUsage> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a NUL-terminated string and `stat` is written by statvfs before it's read.
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return None;
    }
    let stat = unsafe { stat.assume_init() };
    #[allow(clippy::unnecessary_cast)] // the field types differ between platforms
    let frsize = stat.f_frsize as u64;
    #[allow(clippy::unnecessary_cast)]
    let free = (stat.f_bavail as u64).checked_mul(frsize)?;
    #[allow(clippy::unnecessary_cast)]
    let total = (stat.f_blocks as u64).checked_mul(frsize)?;
    Some(DiskUsage { free, total })
}

#[cfg(windows)]
fn usage(dir: &Path) -> Option<DiskUsage> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let path: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    let mut total = 0u64;
    // SAFETY: `path` is NUL-terminated UTF-16; the last optional out-param may be null.
    let ok = unsafe { GetDiskFreeSpaceExW(path.as_ptr(), &mut available, &mut total, std::ptr::null_mut()) };
    (ok != 0).then_some(DiskUsage { free: available, total })
}

#[cfg(not(any(unix, windows)))]
fn usage(_: &Path) -> Option<DiskUsage> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_folder_has_some_space_and_a_missing_one_asks_its_parent() {
        let here = std::env::temp_dir();
        assert!(free_bytes(&here).is_some_and(|b| b > 0));
        assert!(free_bytes(&here.join("polar-not-made-yet/deeper")).is_some());
        let u = disk_usage(&here).expect("temp dir has disk usage");
        assert!(u.total >= u.free && u.total > 0);
    }

    #[test]
    fn disk_full_guard_triggers_at_95_percent_or_low_reserve() {
        let gib = 1024 * 1024 * 1024u64;
        // 100 GiB disk with 10 GiB free (90% used): ok.
        assert!(!DiskUsage { free: 10 * gib, total: 100 * gib }.is_full());
        // 100 GiB disk with 5 GiB free (95% used): full!
        assert!(DiskUsage { free: 5 * gib, total: 100 * gib }.is_full());
        // 4 GiB disk with 400 MiB free (< 512 MiB reserve): full!
        assert!(DiskUsage { free: 400 * 1024 * 1024, total: 4 * gib }.is_full());
    }
}
