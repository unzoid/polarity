//! Whose turn it is at the one mpv.
//!
//! The page builds a new player for every episode and every source picked, and
//! each sends its own loads and stops. A load waits on a link check first, so
//! an older player's load or stop can arrive after a newer player's. Each
//! player names itself with a number; a load nobody wants any more is dropped
//! before mpv hears of it, and a stop only counts for the file mpv has.

use std::sync::atomic::{AtomicU64, Ordering};

/// Which player asked last, and whose file mpv has. `0` is nobody.
#[derive(Default)]
pub struct Turns {
    asked: AtomicU64,
    loaded: AtomicU64,
}

impl Turns {
    /// A player asks for a load. `None` (a caller that names no player) changes nothing.
    pub fn ask(&self, owner: Option<u64>) {
        if let Some(o) = owner {
            self.asked.store(o, Ordering::SeqCst);
        }
    }

    /// After a wait: is this player's load still the one wanted? Always for `None`.
    pub fn wanted(&self, owner: Option<u64>) -> bool {
        match owner {
            Some(o) => self.asked.load(Ordering::SeqCst) == o,
            None => true,
        }
    }

    /// mpv is being told to open this player's file.
    pub fn opened(&self, owner: Option<u64>) {
        self.loaded.store(owner.unwrap_or(0), Ordering::SeqCst);
    }

    /// May this player stop mpv? Not while mpv has another player's file. Always for `None`.
    pub fn may_stop(&self, owner: Option<u64>) -> bool {
        match owner {
            Some(o) => {
                let has = self.loaded.load(Ordering::SeqCst);
                has == 0 || has == o
            }
            None => true,
        }
    }

    /// mpv was stopped: it has nobody's file.
    pub fn stopped(&self) {
        self.loaded.store(0, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_load_still_wanted_goes_ahead() {
        let t = Turns::default();
        t.ask(Some(1));
        assert!(t.wanted(Some(1)));
    }

    #[test]
    fn an_older_players_load_is_dropped_once_a_newer_one_asked() {
        let t = Turns::default();
        t.ask(Some(1));
        t.ask(Some(2));
        assert!(!t.wanted(Some(1)));
        assert!(t.wanted(Some(2)));
    }

    #[test]
    fn an_older_players_stop_leaves_the_newer_players_file() {
        let t = Turns::default();
        t.ask(Some(1));
        t.ask(Some(2));
        t.opened(Some(2));
        assert!(!t.may_stop(Some(1)));
        assert!(t.may_stop(Some(2)));
    }

    #[test]
    fn a_player_stops_its_own_file_before_the_next_one_loads() {
        let t = Turns::default();
        t.ask(Some(1));
        t.opened(Some(1));
        t.ask(Some(2));
        assert!(t.may_stop(Some(1)));
        t.stopped();
        t.opened(Some(2));
        assert!(!t.may_stop(Some(1)));
    }

    #[test]
    fn a_stop_with_nothing_loaded_goes_through() {
        let t = Turns::default();
        assert!(t.may_stop(Some(1)));
    }

    #[test]
    fn a_caller_that_names_no_player_is_never_held_back() {
        let t = Turns::default();
        t.ask(Some(2));
        t.opened(Some(2));
        assert!(t.wanted(None));
        assert!(t.may_stop(None));
        t.ask(None);
        assert!(t.wanted(Some(2)));
    }
}
