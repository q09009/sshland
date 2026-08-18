mod commands_config;
mod dashboard_config;
mod error;
mod macros;
mod settings;
mod ssh;

use ssh::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionManager::new())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                use windows_core::Interface;

                if let Some(window) = app.get_webview_window("main") {
                    window.with_webview(|webview| unsafe {
                        // Ctrl+Shift+C is a WebView2 developer-tools accelerator.
                        // Disable browser-only accelerators so terminal shortcuts
                        // are delivered to xterm instead.
                        if let Ok(core) = webview.controller().CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
                                    let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
                                }
                            }
                        }
                    })?;
                }
            }

            Ok(())
        })
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
            ssh::poll_widget_command,
            ssh::run_macro,
            ssh::stop_macro,
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
            commands_config::open_commands_dir,
            dashboard_config::load_dashboard_widget_configs,
            dashboard_config::dashboard_widgets_dir_path,
            macros::list_macros,
            macros::save_macro,
            macros::delete_macro,
            macros::macros_dir_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
