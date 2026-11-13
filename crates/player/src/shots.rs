//! Screenshots the viewer saves from the player: their file names.

use std::path::{Path, PathBuf};

/// The longest a title may make a file name (characters), so a long episode title stays a usable name.
const TITLE_MAX: usize = 80;

/// "Title 01.02.03.jpg": what's playing and where, as a file name every system takes. The title comes from
/// the page (an add-on's metadata), so it's cut down to plain characters: no folder separators, no
/// characters Windows refuses, no `..`, no control characters, no name Windows reserves.
pub fn shot_name(title: &str, at: f64) -> String {
    let clean: String =
        title.chars().map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { ' ' } else { c }).collect();
    let mut words = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if words.chars().count() > TITLE_MAX {
        words = words.chars().take(TITLE_MAX).collect::<String>().trim_end().to_string();
    }
    // Windows drops trailing dots and spaces, and a name of dots only would be `.` or `..`.
    let words = words.trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    let reserved = {
        let stem = words.split('.').next().unwrap_or("").to_ascii_uppercase();
        matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit())
    };
    let title = if words.is_empty() || reserved { "Screenshot".to_string() } else { words };
    let secs = if at.is_finite() && at > 0.0 { at as u64 } else { 0 };
    format!("{title} {:02}.{:02}.{:02}.jpg", secs / 3600, secs / 60 % 60, secs % 60)
}

/// `name` in `dir`, or "name (2).jpg", "name (3).jpg"… when that's taken: a screenshot never replaces another.
pub fn unused_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, "jpg"));
    (2..).map(|n| dir.join(format!("{stem} ({n}).{ext}"))).find(|p| !p.exists()).expect("some number is free")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_say_what_and_where() {
        assert_eq!(shot_name("Big Buck Bunny", 754.6), "Big Buck Bunny 00.12.34.jpg");
        assert_eq!(shot_name("S1:E2 · A Title", 3725.0), "S1 E2 · A Title 01.02.05.jpg");
        assert_eq!(shot_name("Film", f64::NAN), "Film 00.00.00.jpg");
    }

    #[test]
    fn a_title_never_leaves_the_folder_or_breaks_windows() {
        for evil in ["../../x", "..\\..\\x", "C:\\Windows\\x", "a/b", "\u{0}x\n"] {
            let name = shot_name(evil, 1.0);
            assert!(!name.contains(['/', '\\', ':']) && !name.starts_with('.') && !name.contains('\u{0}'), "{name}");
        }
        assert_eq!(shot_name("...", 1.0), "Screenshot 00.00.01.jpg");
        assert_eq!(shot_name("CON", 1.0), "Screenshot 00.00.01.jpg");
        assert_eq!(shot_name("com1", 1.0), "Screenshot 00.00.01.jpg");
        assert_eq!(shot_name("Console", 1.0), "Console 00.00.01.jpg");
        assert_eq!(shot_name("Ends with a dot.", 1.0), "Ends with a dot 00.00.01.jpg");
        assert!(shot_name(&"x".repeat(500), 1.0).len() < 100);
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = std::env::temp_dir().join(format!("polar-shots-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unused_path(&dir, "Film 00.00.01.jpg");
        assert_eq!(first, dir.join("Film 00.00.01.jpg"));
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(unused_path(&dir, "Film 00.00.01.jpg"), dir.join("Film 00.00.01 (2).jpg"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
