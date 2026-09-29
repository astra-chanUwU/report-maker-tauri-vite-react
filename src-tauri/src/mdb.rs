//! Raw `.sp3` (MS Access Jet DB) support via the `mdb-export` CLI.
//!
//! The WebView cannot read Jet databases, so the Tauri backend shells out to
//! `mdb-export` (mdbtools) to dump the `Data` table to CSV, which the existing
//! Spec-CSV parser (`src/lib/specdata.ts`) understands.
//!
//! Tool resolution order: explicit settings override â†’ `MDB_EXPORT_PATH` env â†’ `PATH`.
//! The full CSV streams straight to a temp file (never held in memory); only a
//! small head (for preview parsing) is returned over IPC.

use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// First bytes of the CSV returned inline for preview parsing (1 MiB cap).
const HEAD_CAP: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdbToolStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdbExportResult {
    /// Temp-file path of the full CSV export.
    pub csv_path: String,
    /// Data rows (excluding header).
    pub rows: usize,
    /// CSV size in bytes.
    pub bytes: u64,
    /// First HEAD_CAP bytes of the CSV for preview parsing.
    pub head: Vec<u8>,
}

fn candidate_tool_paths(override_path: Option<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = override_path {
        let p = p.trim();
        if (!p.is_empty()) {
            out.push(PathBuf::from(p));
        }
    }
    if let Ok(p) = std::env::var("MDB_EXPORT_PATH") {
        if (!p.trim().is_empty()) {
            out.push(PathBuf::from(p));
        }
    }
    out.push(PathBuf::from("mdb-export"));
    out.push(PathBuf::from("mdb-export.exe"));
    out
}

fn resolve_tool(override_path: Option<String>) -> Option<PathBuf> {
    for cand in candidate_tool_paths(override_path) {
        // A bare name relies on PATH; an absolute/relative path must exist.
        let has_sep = cand.to_string_lossy().contains(['/', '\\']);
        if (has_sep && cand.is_file()) || !has_sep {
            return Some(cand);
        }
    }
    None
}

fn tool_version(tool: &PathBuf) -> String {
    match Command::new(tool).arg("--version").output() {
        Ok(o) => {
            let mut s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if (s.is_empty()) {
                s = String::from_utf8_lossy(&o.stderr).trim().to_string();
            }
            if (s.is_empty()) {
                "responded".into()
            } else {
                s.lines().next().unwrap_or("").chars().take(80).collect()
            }
        }
        Err(e) => format!("spawn failed: {e}"),
    }
}

#[tauri::command]
pub fn mdb_tool_status(override_path: Option<String>) -> MdbToolStatus {
    match resolve_tool(override_path) {
        Some(p) => {
            // Verify it actually spawns.
            let probe = Command::new(&p).arg("--version").output();
            match probe {
                Ok(_) => MdbToolStatus {
                    found: true,
                    path: Some(p.to_string_lossy().into_owned()),
                    version: tool_version(&p),
                },
                Err(e) => MdbToolStatus {
                    found: false,
                    path: Some(p.to_string_lossy().into_owned()),
                    version: format!("not runnable: {e}"),
                },
            }
        }
        None => MdbToolStatus { found: false, path: None, version: String::new() },
    }
}

#[tauri::command]
pub fn export_mdb_csv(
    input: String,
    table: Option<String>,
    tool: Option<String>,
) -> Result<MdbExportResult, String> {
    let bin = resolve_tool(tool).ok_or_else(|| {
        "mdb-export not found. Install mdbtools (or set MDB_EXPORT_PATH / Settings path).".to_string()
    })?;
    let table = table.unwrap_or_else(|| "Data".to_string());
    if (table.trim().is_empty()) {
        return Err("Table name is empty.".to_string());
    }
    let input_path = PathBuf::from(&input);
    if (!input_path.is_file()) {
        return Err(format!("Input file not found: {input}"));
    }

    let mut child = Command::new(&bin)
        .arg(&input)
        .arg(&table)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run mdb-export: {e}"))?;

    let stem = input_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".into());
    let csv_path = std::env::temp_dir().join(format!(
        "report-maker-{}-{}.csv",
        sanitize(&stem),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    let mut file = std::fs::File::create(&csv_path)
        .map_err(|e| format!("cannot write temp csv: {e}"))?;

    let mut rows: usize = 0;
    let mut bytes: u64 = 0;
    let mut head: Vec<u8> = Vec::new();
    let mut newline_seen = false;
    if let Some(mut stdout) = child.stdout.take() {
        let mut chunk = [0u8; 65536];
        loop {
            let n = stdout.read(&mut chunk).map_err(|e| format!("read failed: {e}"))?;
            if (n == 0) {
                break;
            }
            let buf = &chunk[..n];
            file.write_all(buf).map_err(|e| format!("write failed: {e}"))?;
            bytes += n as u64;
            if (head.len() < HEAD_CAP) {
                let take = (HEAD_CAP - head.len()).min(n);
                head.extend_from_slice(&buf[..take]);
            }
            // Newlines: handle both \n and UTF-16LE \n\0 (count \n bytes; the
            // \0 of UTF-16LE never collides with a 0x0A byte scan for \r\n/\n).
            for &b in buf {
                if (b == b'\n') {
                    if (newline_seen) {
                        rows += 1;
                    } else {
                        newline_seen = true;
                    }
                }
            }
        }
    }

    let output = child.wait_with_output().map_err(|e| format!("wait failed: {e}"))?;
    if (!output.status.success()) {
        let _ = std::fs::remove_file(&csv_path);
        let err = String::from_utf8_lossy(&output.stderr).trim().chars().take(300).collect::<String>();
        return Err(format!("mdb-export failed: {err}"));
    }
    if (bytes < 16 || !newline_seen) {
        let _ = std::fs::remove_file(&csv_path);
        return Err("mdb-export produced no output â€” is this a valid .sp3 with a Data table?".to_string());
    }

    Ok(MdbExportResult {
        csv_path: csv_path.to_string_lossy().into_owned(),
        rows,
        bytes,
        head,
    })
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if (c.is_ascii_alphanumeric() || c == '-' || c == '_') { c } else { '-' })
        .take(40)
        .collect()
}
