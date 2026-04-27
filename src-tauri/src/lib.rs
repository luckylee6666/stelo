mod audit;
mod commands;
mod credentials;
mod forward;
mod task_cancel;
mod known_hosts;
mod metrics;
mod sessions_store;
mod sftp;
mod ssh;

#[cfg(test)]
mod smoke_tests;

use commands::{
    ai_providers_load, ai_providers_save, app_version, credential_delete, credential_load,
    credential_save, forward_start, forward_stop, groups_load, groups_save, history_load,
    history_save, keys_load, keys_save, sessions_load, sessions_save, sftp_delete, sftp_download,
    config_export, config_export_file, config_import, config_import_file, known_hosts_list,
    known_hosts_remove, sftp_list, sftp_mkdir,
    sftp_read, sftp_read_bytes, sftp_rename, sftp_upload, sftp_upload_dir, sftp_upload_with_sudo,
    sftp_write,
    sftp_write_bytes, snippets_load, snippets_save, ssh_connect, ssh_disconnect, ssh_exec_sudo,
    task_cancel,
    ssh_resize, ssh_send,
};
use forward::ForwardRegistry;
use ssh::SshRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,hypershell=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(SshRegistry::new())
        .manage(ForwardRegistry::new())
        .invoke_handler(tauri::generate_handler![
            app_version,
            ssh_connect,
            ssh_send,
            ssh_exec_sudo,
            known_hosts_list,
            known_hosts_remove,
            config_export,
            config_import,
            config_export_file,
            config_import_file,
            ssh_resize,
            ssh_disconnect,
            sessions_load,
            sessions_save,
            credential_save,
            credential_load,
            credential_delete,
            sftp_upload,
            sftp_upload_with_sudo,
            sftp_upload_dir,
            sftp_list,
            sftp_download,
            sftp_read,
            sftp_write,
            sftp_write_bytes,
            sftp_read_bytes,
            sftp_delete,
            sftp_mkdir,
            sftp_rename,
            keys_load,
            keys_save,
            groups_load,
            groups_save,
            forward_start,
            forward_stop,
            snippets_load,
            snippets_save,
            history_load,
            history_save,
            ai_providers_load,
            ai_providers_save,
            task_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
