// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod license;
mod mdb;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // S10: surface Rust panics via stderr (picked up by Tauri logs / crash reporter).
    std::panic::set_hook(Box::new(|info| {
        eprintln!("app panic: {info}");
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            license::validate_license,
            mdb::mdb_tool_status,
            mdb::export_mdb_csv,
            mdb::list_csv_rows,
            mdb::read_csv_row,
            mdb::list_spectra_catalog,
            mdb::extract_machine_picture,
            mdb::list_envelope_samples
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
