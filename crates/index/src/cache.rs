use std::collections::HashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Retry window when a Data Canary guard keeps a Last-Known-Good (LKG) entry instead of
/// overwriting it with a suspicious empty/degraded upstream payload.
const LKG_RETRY_TTL: Duration = Duration::from_secs(5 * 60);

struct Entry<V> {
    value: V,
    inserted_at: Instant,
    expires_at: Instant,
}

/// Small TTL cache with ±15% jitter (to avoid synchronized shelf expiry bursts),
/// per-entry TTLs (volatility-matched expiration), and Last-Known-Good (LKG) guards.
pub struct TtlCache<K, V> {
    ttl: Duration,
    capacity: usize,
    entries: Mutex<HashMap<K, Entry<V>>>,
}

/// Fast, zero-dependency ±15% jitter factor using splitmix64 over an atomic counter.
fn jittered(ttl: Duration) -> Duration {
    if ttl.is_zero() {
        return Duration::ZERO;
    }
    static COUNTER: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    let mut z = COUNTER.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    // Map uniformly into [0.85, 1.15] in fixed-point basis points [8500, 11500].
    let bps = 8500 + (z % 3001);
    let nanos = (ttl.as_nanos() * (bps as u128)) / 10_000;
    Duration::from_nanos(nanos.min(u64::MAX as u128) as u64).max(Duration::from_nanos(1))
}

/// Scale a desktop cache capacity down for memory-constrained devices (e.g. 2–4 GB TV sticks/phones).
pub fn scale_capacity(base: usize, ram_mb: u64) -> usize {
    let factor_pct = match ram_mb {
        0..=2048 => 25,
        2049..=4096 => 50,
        4097..=8192 => 75,
        _ => 100,
    };
    ((base * factor_pct) / 100).max(16).min(base)
}

impl<K: Eq + Hash + Clone, V: Clone> TtlCache<K, V> {
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        Self { ttl, capacity, entries: Mutex::new(HashMap::new()) }
    }

    /// Number of entries currently stored (including expired LKG entries awaiting cleanup).
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner).len()
    }

    /// Drop expired entries first, then evict the oldest `fraction` (0.0..=1.0) of remaining entries.
    /// Used by the 3-level memory pressure governor (`Indexer::trim_memory`).
    pub fn evict_fraction(&self, fraction: f32) -> usize {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let before = entries.len();
        let now = Instant::now();
        entries.retain(|_, e| now < e.expires_at);
        let f = fraction.clamp(0.0, 1.0);
        if f >= 1.0 {
            entries.clear();
        } else if f > 0.0 && !entries.is_empty() {
            let to_drop = ((entries.len() as f32) * f).ceil() as usize;
            let mut by_age: Vec<(K, Instant)> = entries.iter().map(|(k, e)| (k.clone(), e.inserted_at)).collect();
            by_age.sort_by_key(|(_, ts)| *ts);
            for (k, _) in by_age.into_iter().take(to_drop) {
                entries.remove(&k);
            }
        }
        before.saturating_sub(entries.len())
    }

    /// Remove every entry from the cache, returning how many entries were cleared.
    pub fn clear(&self) -> usize {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let n = entries.len();
        entries.clear();
        n
    }

    pub fn get(&self, key: &K) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = entries.get(key)?;
        (Instant::now() < entry.expires_at).then(|| entry.value.clone())
    }

    /// Returns the stored entry even if expired (for LKG fallback on upstream failure).
    #[allow(dead_code)]
    pub fn get_stale(&self, key: &K) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries.get(key).map(|e| e.value.clone())
    }

    /// The live entry for `key`, or `make()` stored as it. One lock for both,
    /// so callers racing on a miss share the value one of them made.
    pub fn get_or_insert_with(&self, key: K, make: impl FnOnce() -> V) -> V {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let now = Instant::now();
        if let Some(entry) = entries.get(&key) {
            if now < entry.expires_at {
                return entry.value.clone();
            }
        }
        let value = make();
        self.make_room(&mut entries, now);
        entries.insert(key, Entry { value: value.clone(), inserted_at: now, expires_at: now + jittered(self.ttl) });
        value
    }

    pub fn insert(&self, key: K, value: V) {
        self.insert_with_ttl(key, value, self.ttl);
    }

    /// Insert with an explicit base TTL (jittered ±15%).
    pub fn insert_with_ttl(&self, key: K, value: V, ttl: Duration) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let now = Instant::now();
        self.make_room(&mut entries, now);
        entries.insert(key, Entry { value, inserted_at: now, expires_at: now + jittered(ttl) });
    }

    /// Data Canary Last-Known-Good guard (#620): if a previous entry exists and `accept(old, new)`
    /// returns `false` (e.g., an HTTP-200-empty payload trying to overwrite populated data), keeps
    /// the previous LKG value with a short retry TTL and returns the value that was kept.
    pub fn insert_if_valid(&self, key: K, value: V, ttl: Duration, accept: impl FnOnce(&V, &V) -> bool) -> V {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let now = Instant::now();
        if let Some(existing) = entries.get_mut(&key) {
            if !accept(&existing.value, &value) {
                existing.expires_at = now + jittered(LKG_RETRY_TTL.min(ttl));
                return existing.value.clone();
            }
        }
        self.make_room(&mut entries, now);
        entries.insert(key, Entry { value: value.clone(), inserted_at: now, expires_at: now + jittered(ttl) });
        value
    }

    fn make_room(&self, entries: &mut HashMap<K, Entry<V>>, now: Instant) {
        if entries.len() >= self.capacity {
            // Drop expired entries first, then the oldest inserted if still full.
            entries.retain(|_, e| now < e.expires_at);
            if entries.len() >= self.capacity {
                if let Some(oldest) = entries.iter().min_by_key(|(_, e)| e.inserted_at).map(|(k, _)| k.clone()) {
                    entries.remove(&oldest);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_stays_within_fifteen_percent_and_varies() {
        let base = Duration::from_secs(1000);
        let samples: Vec<Duration> = (0..64).map(|_| jittered(base)).collect();
        for d in &samples {
            assert!(*d >= Duration::from_secs(850) && *d <= Duration::from_secs(1150), "{d:?}");
        }
        let min = *samples.iter().min().unwrap();
        let max = *samples.iter().max().unwrap();
        assert!(max > min, "expected jitter variation, got min={min:?} max={max:?}");
    }

    #[test]
    fn per_entry_ttl_overrides_default() {
        let cache = TtlCache::new(Duration::from_secs(60), 8);
        cache.insert_with_ttl("gone", 1, Duration::ZERO);
        cache.insert_with_ttl("live", 2, Duration::from_secs(60));
        assert_eq!(cache.get(&"gone"), None);
        assert_eq!(cache.get(&"live"), Some(2));
        // Even an expired entry remains accessible via get_stale until overwritten or evicted.
        assert_eq!(cache.get_stale(&"gone"), Some(1));
    }

    #[test]
    fn lkg_guard_preserves_populated_entry_against_empty_overwrite() {
        let cache = TtlCache::new(Duration::from_secs(60), 8);
        cache.insert_with_ttl("show", vec!["ep1", "ep2", "ep3"], Duration::ZERO);
        // Expired, so get() misses and caller refetches upstream.
        assert_eq!(cache.get(&"show"), None);
        // Upstream returns HTTP 200 with an empty list: guard rejects overwrite and restores LKG.
        let kept = cache.insert_if_valid("show", Vec::new(), Duration::from_secs(3600), |old, new| {
            !(!old.is_empty() && new.is_empty())
        });
        assert_eq!(kept, vec!["ep1", "ep2", "ep3"]);
        assert_eq!(cache.get(&"show"), Some(vec!["ep1", "ep2", "ep3"]));
        // A valid update still overwrites normally.
        let updated =
            cache.insert_if_valid("show", vec!["ep1", "ep2", "ep3", "ep4"], Duration::from_secs(3600), |old, new| {
                !(!old.is_empty() && new.is_empty())
            });
        assert_eq!(updated.len(), 4);
    }

    #[test]
    fn scale_capacity_and_evict_fraction_bound_memory() {
        assert_eq!(scale_capacity(2048, 2048), 512);
        assert_eq!(scale_capacity(2048, 4096), 1024);
        assert_eq!(scale_capacity(2048, 16384), 2048);
        assert_eq!(scale_capacity(32, 1024), 16);

        let cache = TtlCache::new(Duration::from_secs(60), 16);
        for i in 0..10 {
            cache.insert(i, i * 10);
        }
        assert_eq!(cache.len(), 10);
        let evicted = cache.evict_fraction(0.5);
        assert_eq!(evicted, 5);
        assert_eq!(cache.len(), 5);
        cache.clear();
        assert_eq!(cache.len(), 0);
    }
}
