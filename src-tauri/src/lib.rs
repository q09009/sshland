mod error;
mod ssh;

use ssh::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionManager::new())
        .invoke_handler(tauri::generate_handler![
            ssh::connect,
            ssh::list_dir,
            ssh::download,
            ssh::rename,
            ssh::mkdir,
            ssh::delete,
            ssh::disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
