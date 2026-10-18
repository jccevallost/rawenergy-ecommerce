// WIN-01: programa de Windows del panel. Abre el panel publicado en una ventana propia, sin duplicar la
// interfaz: cada despliegue del panel llega solo. La ventana se identifica con «RawEnergyShell/panel-windows/<versión>»
// para que el servidor aplique la versión mínima (VER-01). No concede ninguna capacidad nativa a la página:
// los enlaces a otros sitios se abren en el navegador del sistema.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const PANEL_URL: &str = match option_env!("RAWENERGY_PANEL_URL") {
    Some(url) => url,
    None => "https://icy-meadow-0e332cb10.1.azurestaticapps.net",
};
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let panel = url::Url::parse(PANEL_URL)?;
            let origin = panel.origin();
            let handle = app.handle().clone();
            let opener = app.handle().clone();
            let agent = format!(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0 RawEnergyShell/panel-windows/{VERSION}"
            );
            WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(panel.clone()))
                .title("RawEnergy Gestión")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .user_agent(&agent)
                .on_navigation(move |target| {
                    if target.origin() == origin || target.scheme() == "blob" || target.scheme() == "about" {
                        return true;
                    }
                    if target.scheme() == "https" || target.scheme() == "mailto" {
                        let _ = opener.opener().open_url(target.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar RawEnergy Gestión");
}
