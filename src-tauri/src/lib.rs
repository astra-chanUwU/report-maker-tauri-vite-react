// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod cache;
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
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Evict stale temps on startup without blocking UI
                let _ = handle;
                crate::cache::evict_on_startup().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            license::device_identity_command,
            license::license_status,
            license::get_control_plane_url,
            license::sign_control_plane_request,
            license::activate_license,
            license::refresh_license,
            license::deactivate_license,
            license::validate_license_dev,
            mdb::mdb_tool_status,
            mdb::export_mdb_csv,
            mdb::list_csv_rows,
            mdb::read_csv_row,
            mdb::list_spectra_catalog,
            mdb::extract_machine_picture,
            mdb::list_envelope_samples,
            cache::clear_export_cache,
            cache::cache_status,
            cache::is_cached,
            cache::list_cache_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
