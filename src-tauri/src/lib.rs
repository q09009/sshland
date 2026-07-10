mod error;
mod ssh;

use ssh::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SessionManager::new())
        .invoke_handler(tauri::generate_handler![ssh::connect, ssh::disconnect])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
