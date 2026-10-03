//! Export cache: path + mtime + size → temp CSV reuse.
//! Keeps second open of the same 500 MB .sp3 instant without re-running mdb-export.
//! Backed by a small JSON file in the temp dir (avoids Rust LazyStore API churn).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ENTRIES: usize = 5;
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportCacheEntry {
    pub csv_path: String,
    pub bytes: u64,
    pub rows: usize,
    pub head: Vec<u8>,
    pub mtime_ms: u64,
    pub size: u64,
    pub cached_at_ms: u64,
}

pub type ExportCacheMap = HashMap<String, ExportCacheEntry>;

fn uid_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file_mtime_size(path: &str) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some((mtime, size))
}

fn cache_file() -> PathBuf {
    std::env::temp_dir().join("report-maker-export-cache.json")
}

async fn try_load_via_lazy_store() -> Option<ExportCacheMap> {
    let p = cache_file();
    let data = std::fs::read(&p).ok()?;
    serde_json::from_slice::<ExportCacheMap>(&data).ok()
}

async fn save_map(map: &ExportCacheMap) {
    let p = cache_file();
    if let Ok(data) = serde_json::to_vec(map) {
        let _ = std::fs::write(&p, data);
    }
}

pub fn cache_key(path: &str) -> String {
    uid_path(path)
}

pub async fn get_cached(path: &str) -> Option<ExportCacheEntry> {
    let key = cache_key(path);
    let map = try_load_via_lazy_store().await.unwrap_or_default();
    let entry = map.get(&key)?.clone();
    // Freshness: mtime + size must match, and temp file must still exist
    let (mtime, size) = file_mtime_size(path)?;
    if entry.mtime_ms != mtime || entry.size != size {
        return None;
    }
    if !PathBuf::from(&entry.csv_path).is_file() {
        return None;
    }
    // Age check
    let age = now_ms().saturating_sub(entry.cached_at_ms);
    if age > MAX_AGE_MS {
        return None;
    }
    Some(entry)
}

pub async fn put_cached(path: &str, csv_path: String, bytes: u64, rows: usize, head: Vec<u8>) {
    let (mtime, size) = match file_mtime_size(path) {
        Some(v) => v,
        None => return,
    };
    let key = cache_key(path);
    let mut map = try_load_via_lazy_store().await.unwrap_or_default();
    map.insert(
        key,
        ExportCacheEntry {
            csv_path,
            bytes,
            rows,
            head,
            mtime_ms: mtime,
            size,
            cached_at_ms: now_ms(),
        },
    );
    evict_and_save(&mut map).await;
}

async fn evict_and_save(map: &mut ExportCacheMap) {
    // Sort by cached_at_ms ascending (oldest first) for LRU
    let mut entries: Vec<(String, u64, u64)> = map
        .iter()
        .map(|(k, v)| (k.clone(), v.cached_at_ms, v.bytes))
        .collect();
    entries.sort_by_key(|(_, ts, _)| *ts);
    let now = now_ms();
    let mut to_remove: Vec<String> = Vec::new();
    // Age sweep first
    for (k, ts, _) in &entries {
        if now.saturating_sub(*ts) > MAX_AGE_MS {
            to_remove.push(k.clone());
        }
    }
    for k in &to_remove {
        if let Some(e) = map.remove(k) {
            let _ = std::fs::remove_file(&e.csv_path);
        }
    }
    // Recompute after age sweep
    entries.retain(|(k, _, _)| !to_remove.contains(k));
    let mut total: u64 = entries.iter().map(|(_, _, b)| *b).sum();
    while map.len() > MAX_ENTRIES || total > MAX_BYTES {
        if let Some((k, _, b)) = entries.first().cloned() {
            entries.remove(0);
            total = total.saturating_sub(b);
            if let Some(e) = map.remove(&k) {
                let _ = std::fs::remove_file(&e.csv_path);
            }
        } else {
            break;
        }
    }
    save_map(map).await;
}

#[tauri::command]
pub async fn clear_export_cache() -> Result<(), String> {
    let mut map = try_load_via_lazy_store().await.unwrap_or_default();
    for (_, e) in map.drain() {
        let _ = std::fs::remove_file(&e.csv_path);
    }
    save_map(&map).await;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub entries: usize,
    pub total_bytes: u64,
}

#[tauri::command]
pub async fn cache_status() -> Result<CacheStatus, String> {
    let map = try_load_via_lazy_store().await.unwrap_or_default();
    let total = map.values().map(|e| e.bytes).sum();
    Ok(CacheStatus {
        entries: map.len(),
        total_bytes: total,
    })
}

pub async fn evict_on_startup() {
    let mut map = try_load_via_lazy_store().await.unwrap_or_default();
    if map.is_empty() {
        return;
    }
    // Remove entries whose temp file no longer exists or is stale
    let mut to_remove: Vec<String> = Vec::new();
    let now = now_ms();
    for (k, e) in &map {
        if !PathBuf::from(&e.csv_path).is_file() || now.saturating_sub(e.cached_at_ms) > MAX_AGE_MS {
            to_remove.push(k.clone());
        }
    }
    for k in to_remove {
        if let Some(e) = map.remove(&k) {
            let _ = std::fs::remove_file(&e.csv_path);
        }
    }
    evict_and_save(&mut map).await;
}
