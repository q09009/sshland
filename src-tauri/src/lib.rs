mod commands_config;
mod error;
mod settings;
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
            ssh::upload,
            ssh::rename,
            ssh::mkdir,
            ssh::create_file,
            ssh::delete,
            ssh::copy,
            ssh::read_remote_file,
            ssh::write_remote_file,
            ssh::open_terminal,
            ssh::write_terminal,
            ssh::resize_terminal,
            ssh::close_terminal,
            ssh::disconnect,
            settings::load_settings,
            settings::save_settings,
            commands_config::load_command_configs,
            commands_config::commands_dir_path,
            commands_config::open_commands_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
