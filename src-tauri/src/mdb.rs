//! Raw `.sp3` (MS Access Jet DB) support via the `mdb-export` CLI.
//!
//! The WebView cannot read Jet databases, so the Tauri backend shells out to
//! `mdb-export` (mdbtools) to dump the `Data` table to CSV, which the existing
//! Spec-CSV parser (`src/lib/specdata.ts`) understands.
//!
//! Tool resolution order: explicit settings override -> `MDB_EXPORT_PATH` env -> `PATH`.
//! The full CSV streams straight to a temp file (never held in memory); only a
//! small head (for preview parsing) is returned over IPC.

use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdbExportProgress {
    pub bytes: u64,
    pub rows: usize,
}

fn candidate_tool_paths(override_path: Option<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = override_path {
        let p = p.trim();
        if !p.is_empty() {
            out.push(PathBuf::from(p));
        }
    }
    if let Ok(p) = std::env::var("MDB_EXPORT_PATH") {
        if !p.trim().is_empty() {
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
            if s.is_empty() {
                s = String::from_utf8_lossy(&o.stderr).trim().to_string();
            }
            if s.is_empty() {
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
        None => MdbToolStatus {
            found: false,
            path: None,
            version: String::new(),
        },
    }
}

#[tauri::command]
pub fn export_mdb_csv(
    input: String,
    table: Option<String>,
    tool: Option<String>,
    on_progress: Channel<MdbExportProgress>,
) -> Result<MdbExportResult, String> {
    let bin = resolve_tool(tool).ok_or_else(|| {
        "mdb-export not found. Install mdbtools (or set MDB_EXPORT_PATH / Settings path)."
            .to_string()
    })?;
    let table = table.unwrap_or_else(|| "Data".to_string());
    if table.trim().is_empty() {
        return Err("Table name is empty.".to_string());
    }
    let input_path = PathBuf::from(&input);
    if !input_path.is_file() {
        return Err(format!("Input file not found: {input}"));
    }

    // CH-family .sp3 files store Specdata as OLE blobs with embedded NUL/0x0A
    // bytes that split CSV rows mid-field unless we ask for octal escapes.
    // `mdb-export -b octal` yields \ooo per byte so the CSV stays line-oriented
    // and our `\\ooo` decoder (specdata.ts) can recover the original bytes.
    let mut child = if table == "Data" {
        Command::new(&bin)
            .arg("-b")
            .arg("octal")
            .arg(&input)
            .arg(&table)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run mdb-export: {e}"))?
    } else {
        Command::new(&bin)
            .arg(&input)
            .arg(&table)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run mdb-export: {e}"))?
    };

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
    let mut file =
        std::fs::File::create(&csv_path).map_err(|e| format!("cannot write temp csv: {e}"))?;

    let mut rows: usize = 0;
    let mut bytes: u64 = 0;
    let mut head: Vec<u8> = Vec::new();
    let mut newline_seen = false;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut last_emit_bytes: u64 = 0;
    let emit_progress = |bytes: u64, rows: usize, channel: &Channel<MdbExportProgress>| {
        let _ = channel.send(MdbExportProgress { bytes, rows });
    };
    if let Some(mut stdout) = child.stdout.take() {
        let mut chunk = [0u8; 65536];
        loop {
            let n = stdout
                .read(&mut chunk)
                .map_err(|e| format!("read failed: {e}"))?;
            if n == 0 {
                break;
            }
            let buf = &chunk[..n];
            file.write_all(buf)
                .map_err(|e| format!("write failed: {e}"))?;
            bytes += n as u64;
            if head.len() < HEAD_CAP {
                let take = (HEAD_CAP - head.len()).min(n);
                head.extend_from_slice(&buf[..take]);
            }
            // Newlines: handle both \n and UTF-16LE \n\0 (count \n bytes; the
            // \0 of UTF-16LE never collides with a 0x0A byte scan for \r\n/\n).
            for &b in buf {
                if b == b'\n' {
                    if newline_seen {
                        rows += 1;
                    } else {
                        newline_seen = true;
                    }
                }
            }
            // Throttle IPC: every ~250ms or every ~2 MiB.
            if last_emit.elapsed() >= Duration::from_millis(250) || bytes - last_emit_bytes >= 2 * 1024 * 1024
            {
                emit_progress(bytes, rows, &on_progress);
                last_emit = Instant::now();
                last_emit_bytes = bytes;
            }
        }
    }
    emit_progress(bytes, rows, &on_progress);

    let output = child
        .wait_with_output()
        .map_err(|e| format!("wait failed: {e}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&csv_path);
        let err = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(300)
            .collect::<String>();
        return Err(format!("mdb-export failed: {err}"));
    }
    if bytes < 16 || !newline_seen {
        let _ = std::fs::remove_file(&csv_path);
        return Err(
            "mdb-export produced no output -- is this a valid .sp3 with a Data table?".to_string(),
        );
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
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(40)
        .collect()
}

// ---------------------------------------------------------------------------
// Row access for the measurement picker (refinement #2).
//
// Converted CSVs can hold thousands of measurements; the frontend previews
// row 0 first, then lists/loads any row on demand. Summaries omit the huge
// Specdata blob; single-row reads return full cells for frontend parsing.
// ---------------------------------------------------------------------------

/// Hard cap to keep IPC payloads sane (largest real export: ~3k rows).
const ROW_LIST_CAP: usize = 50000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowSummary {
    pub index: usize,
    pub point_id: String,
    pub direction_id: String,
    pub meas_date: String,
    pub peak_v: String,
    pub peak_freq: String,
    pub rms_v: String,
    pub rms_a: String,
    pub peak_a: String,
    pub bc: String,
    pub unit: String,
    pub no_lines: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowList {
    pub header: Vec<String>,
    pub rows: Vec<CsvRowSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvFullRow {
    pub header: Vec<String>,
    pub cells: Vec<String>,
}

/// Quote-aware CSV split (mirrors `splitCsvLine` in `src/lib/specdata.ts`).
fn split_csv_line(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            cells.push(std::mem::take(&mut cur));
        } else {
            cur.push(c);
        }
    }
    cells.push(cur);
    cells
}

fn read_csv_text(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read csv: {e}"))?;
    if bytes.len() > 1536 * 1024 * 1024 {
        return Err("CSV larger than 1.5 GiB is not supported.".to_string());
    }
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(String::from_utf16_lossy(&u16s))
    } else {
        let start =
            if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
                3
            } else {
                0
            };
        Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
    }
}

fn col(cells: &[String], header: &[String], name: &str) -> String {
    header
        .iter()
        .position(|h| h == name)
        .and_then(|i| cells.get(i))
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_csv_rows(path: String, limit: Option<usize>) -> Result<CsvRowList, String> {
    let text = read_csv_text(&path)?;
    let mut lines = text.lines();
    let header_line = lines.next().ok_or("CSV is empty.")?.to_string();
    let header = split_csv_line(&header_line);
    if !header.contains(&"Specdata".to_string()) {
        return Err("Not a Data-table export (no Specdata column).".to_string());
    }
    let cap = limit.unwrap_or(ROW_LIST_CAP).min(ROW_LIST_CAP);
    let mut rows = Vec::new();
    for (index, line) in lines.enumerate() {
        if rows.len() >= cap {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        let cells = split_csv_line(line);
        rows.push(CsvRowSummary {
            index,
            point_id: col(&cells, &header, "PointID"),
            direction_id: col(&cells, &header, "DirectionID"),
            meas_date: col(&cells, &header, "MeasDate"),
            peak_v: col(&cells, &header, "ValuePeakMaxV"),
            peak_freq: col(&cells, &header, "FreqPeakMaxV"),
            rms_v: col(&cells, &header, "TotalRMSV"),
            rms_a: col(&cells, &header, "TotalRMSA"),
            peak_a: col(&cells, &header, "TotalPeakA"),
            bc: col(&cells, &header, "BC"),
            unit: col(&cells, &header, "Unit"),
            no_lines: col(&cells, &header, "NoLines"),
        });
    }
    Ok(CsvRowList { header, rows })
}

#[tauri::command]
pub fn read_csv_row(path: String, index: usize) -> Result<CsvFullRow, String> {
    let text = read_csv_text(&path)?;
    let mut lines = text.lines();
    let header_line = lines.next().ok_or("CSV is empty.")?.to_string();
    let header = split_csv_line(&header_line);
    let mut seen = 0usize;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        if seen == index {
            return Ok(CsvFullRow {
                header,
                cells: split_csv_line(line),
            });
        }
        seen += 1;
    }
    Err(format!("Row {index} out of range."))
}

// ---------------------------------------------------------------------------
// Spectra catalog (Plant / Machine / Point / Direction) — text only.
// Binary columns (MachPicture) are stripped; JPEG is a separate command.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectraCatalogCsv {
    pub plant_csv: String,
    pub machine_csv: String,
    pub point_csv: String,
    pub direction_csv: String,
    pub gmachine_csv: String,
    pub gdirection_csv: String,
}

fn run_mdb_export(
    bin: &PathBuf,
    input: &str,
    table: &str,
    bin_mode: &str,
) -> Result<Vec<u8>, String> {
    let output = Command::new(bin)
        .arg("-b")
        .arg(bin_mode)
        .arg(input)
        .arg(table)
        .output()
        .map_err(|e| format!("failed to run mdb-export: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(300)
            .collect::<String>();
        return Err(format!("mdb-export {table} failed: {err}"));
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn list_spectra_catalog(
    input: String,
    tool: Option<String>,
) -> Result<SpectraCatalogCsv, String> {
    let bin = resolve_tool(tool).ok_or_else(|| {
        "mdb-export not found. Install mdbtools (or set MDB_EXPORT_PATH / Settings path)."
            .to_string()
    })?;
    let input_path = PathBuf::from(&input);
    if !input_path.is_file() {
        return Err(format!("Input file not found: {input}"));
    }
    let plant =
        String::from_utf8_lossy(&run_mdb_export(&bin, &input, "Plant", "strip")?).into_owned();
    let machine =
        String::from_utf8_lossy(&run_mdb_export(&bin, &input, "Machine", "strip")?).into_owned();
    let point =
        String::from_utf8_lossy(&run_mdb_export(&bin, &input, "Point", "strip")?).into_owned();
    let direction =
        String::from_utf8_lossy(&run_mdb_export(&bin, &input, "Direction", "strip")?).into_owned();
    if !machine.contains("MachineID") {
        return Err("Machine table missing from this .sp3.".to_string());
    }
    let gmachine = run_mdb_export(&bin, &input, "GMachine", "strip")
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let gdirection = run_mdb_export(&bin, &input, "GDirection", "strip")
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    Ok(SpectraCatalogCsv {
        plant_csv: plant,
        machine_csv: machine,
        point_csv: point,
        direction_csv: direction,
        gmachine_csv: gmachine,
        gdirection_csv: gdirection,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeSample {
    pub point_id: String,
    pub direction_id: String,
    pub meas_date: String,
    pub rms: String,
    pub unit: String,
}

fn positive(v: &str) -> bool {
    v.trim().parse::<f64>().map(|n| n > 0.0).unwrap_or(false)
}

/// EnvelopeData overalls (OLE stripped) so trends can join by direction + date.
/// Spectra stores the envelope overall in TotalRMSA (gEN); TotalRMSV is usually 0.
#[tauri::command]
pub fn list_envelope_samples(
    input: String,
    tool: Option<String>,
) -> Result<Vec<EnvelopeSample>, String> {
    let bin = resolve_tool(tool).ok_or_else(|| "mdb-export not found.".to_string())?;
    let raw = run_mdb_export(&bin, &input, "EnvelopeData", "strip")?;
    let text = String::from_utf8_lossy(&raw);
    let mut lines = text.lines();
    let header = split_csv_line(lines.next().unwrap_or(""));
    let mut out = Vec::new();
    for line in lines {
        if line.trim().is_empty() || out.len() >= ROW_LIST_CAP {
            continue;
        }
        let cells = split_csv_line(line);
        let rms = ["TotalRMSA", "TotalRMSV", "TotalRMSD"]
            .iter()
            .map(|c| col(&cells, &header, c))
            .find(|v| positive(v));
        let Some(rms) = rms else {
            continue;
        };
        out.push(EnvelopeSample {
            point_id: col(&cells, &header, "PointID"),
            direction_id: col(&cells, &header, "DirectionID"),
            meas_date: col(&cells, &header, "MeasDate"),
            rms,
            unit: col(&cells, &header, "Unit").trim_matches('"').trim().to_string(),
        });
    }
    Ok(out)
}

/// Hex-export Machine and return the JPEG bytes of one MachPicture, if any.
#[tauri::command]
pub fn extract_machine_picture(
    input: String,
    machine_id: String,
    tool: Option<String>,
) -> Result<Vec<u8>, String> {
    let bin = resolve_tool(tool).ok_or_else(|| "mdb-export not found.".to_string())?;
    let raw = run_mdb_export(&bin, &input, "Machine", "hex")?;
    let text = String::from_utf8_lossy(&raw);
    let mut lines = text.lines();
    let header = split_csv_line(lines.next().unwrap_or(""));
    let pic_i = header
        .iter()
        .position(|h| h == "MachPicture")
        .ok_or("MachPicture column missing.")?;
    let id_i = header
        .iter()
        .position(|h| h == "MachineID")
        .ok_or("MachineID column missing.")?;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let cells = split_csv_line(line);
        if cells.get(id_i).map(|s| s.trim()) != Some(machine_id.trim()) {
            continue;
        }
        let field = cells.get(pic_i).cloned().unwrap_or_default();
        return jpeg_from_hex(&field).ok_or_else(|| "No JPEG in MachPicture.".to_string());
    }
    Err(format!("Machine {machine_id} not found."))
}

fn jpeg_from_hex(field: &str) -> Option<Vec<u8>> {
    let hex: String = field.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let lower = hex.to_ascii_lowercase();
    let start = lower.find("ffd8")?;
    let start = start - (start % 2);
    let slice = &hex[start..];
    if slice.len() < 8 || slice.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(slice.len() / 2);
    let bytes = slice.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let hi = hex_val(bytes[i])?;
        let lo = hex_val(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    if out.len() >= 3 && out[0] == 0xFF && out[1] == 0xD8 {
        Some(out)
    } else {
        None
    }
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
