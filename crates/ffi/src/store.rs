//! The TV's own progress file, `polar-tv.json`: one `polar_library::Space`, as
//! the other apps keep one per profile. Opened by the same rules
//! (`polar_library::opened`): only a missing file starts fresh; one that
//! doesn't parse is copied aside first; one that can't be read is never
//! written over.

use std::path::PathBuf;

use polar_library::opened::{open, Opened};
use polar_library::saver::write_atomic;
use polar_library::Space;

use crate::CoreError;

const NAME: &str = "polar-tv.json";

pub(crate) struct File {
    path: PathBuf,
    /// Set when the file couldn't be read: saving does nothing then.
    problem: Option<String>,
}

impl File {
    pub(crate) fn open(dir: PathBuf) -> Result<(Self, Space), CoreError> {
        std::fs::create_dir_all(&dir).map_err(|e| CoreError::Storage { message: e.to_string() })?;
        let path = dir.join(NAME);
        let (space, problem) = match open::<Space>(std::fs::read(&path)) {
            Opened::Fresh => (Space::default(), None),
            Opened::Data(space) => (space, None),
            Opened::Corrupt(_) => {
                let aside = dir.join(format!("{NAME}.corrupt-{}", crate::now_ms()));
                std::fs::copy(&path, &aside).map_err(|e| CoreError::Storage { message: e.to_string() })?;
                (Space::default(), None)
            }
            Opened::Unreadable(e) => (Space::default(), Some(e)),
        };
        Ok((Self { path, problem }, space))
    }

    pub(crate) fn save(&self, space: &Space) -> Result<(), CoreError> {
        if self.problem.is_some() {
            return Ok(());
        }
        let bytes = serde_json::to_vec(space).map_err(|e| CoreError::Storage { message: e.to_string() })?;
        write_atomic(&self.path, &bytes).map_err(|e| CoreError::Storage { message: e.to_string() })
    }

    pub(crate) fn problem(&self) -> Option<String> {
        self.problem.clone()
    }
}
