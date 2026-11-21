use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::sync::OnceCell;

/// Small TTL cache. Metadata changes slowly; the point is that revisiting a
/// title or scrolling back up a catalog never waits on the network.
pub struct TtlCache<K, V> {
    ttl: Duration,
    capacity: usize,
    entries: Mutex<HashMap<K, (Instant, V)>>,
}

impl<K: Eq + Hash + Clone, V: Clone> TtlCache<K, V> {
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        Self { ttl, capacity, entries: Mutex::new(HashMap::new()) }
    }

    pub fn get(&self, key: &K) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let (at, value) = entries.get(key)?;
        (at.elapsed() < self.ttl).then(|| value.clone())
    }

    /// The live entry for `key`, or `make()` stored as it. One lock for both,
    /// so callers racing on a miss share the value one of them made.
    pub fn get_or_insert_with(&self, key: K, make: impl FnOnce() -> V) -> V {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((at, value)) = entries.get(&key) {
            if at.elapsed() < self.ttl {
                return value.clone();
            }
        }
        let value = make();
        self.make_room(&mut entries);
        entries.insert(key, (Instant::now(), value.clone()));
        value
    }

    pub fn insert(&self, key: K, value: V) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        self.make_room(&mut entries);
        entries.insert(key, (Instant::now(), value));
    }

    /// Snapshot up to `limit` newest live entries for lightweight disk persistence.
    pub fn snapshot(&self, limit: usize) -> Vec<(K, V)> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let mut live: Vec<(Instant, K, V)> = entries
            .iter()
            .filter(|(_, (at, _))| at.elapsed() < self.ttl)
            .map(|(k, (at, v))| (*at, k.clone(), v.clone()))
            .collect();
        if live.len() > limit {
            live.sort_unstable_by_key(|a| std::cmp::Reverse(a.0));
            live.truncate(limit);
        }
        live.into_iter().map(|(_, k, v)| (k, v)).collect()
    }

    fn make_room(&self, entries: &mut HashMap<K, (Instant, V)>) {
        if entries.len() >= self.capacity {
            // Drop expired entries first, then the oldest if still full.
            let ttl = self.ttl;
            entries.retain(|_, (at, _)| at.elapsed() < ttl);
            if entries.len() >= self.capacity {
                if let Some(oldest) = entries.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone()) {
                    entries.remove(&oldest);
                }
            }
        }
    }
}

/// Coalesces concurrent identical in-flight async fetches so overlapping Home shelves and Continue Watching
/// cards never fire duplicate upstream HTTP requests for the same key.
pub struct Singleflight<K, V> {
    inflight: Mutex<HashMap<K, Arc<OnceCell<V>>>>,
}

impl<K: Eq + Hash + Clone, V: Clone> Default for Singleflight<K, V> {
    fn default() -> Self {
        Self { inflight: Mutex::new(HashMap::new()) }
    }
}

impl<K: Eq + Hash + Clone, V: Clone> Singleflight<K, V> {
    pub async fn run<E>(&self, key: K, f: impl Future<Output = std::result::Result<V, E>>) -> std::result::Result<V, E> {
        let cell = {
            let mut map = self.inflight.lock().unwrap_or_else(PoisonError::into_inner);
            map.entry(key.clone()).or_insert_with(|| Arc::new(OnceCell::new())).clone()
        };
        let res = cell.get_or_try_init(|| f).await.cloned();
        let mut map = self.inflight.lock().unwrap_or_else(PoisonError::into_inner);
        if map.get(&key).is_some_and(|cur| Arc::ptr_eq(cur, &cell)) {
            map.remove(&key);
        }
        res
    }
}
