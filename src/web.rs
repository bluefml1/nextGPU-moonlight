use actix_files::Files;
use actix_web::{HttpResponse, dev::HttpServiceFactory, get, services, web::Data};
use common::{api_bindings::ConfigJs, api_bindings_ext::TsAny};
use log::warn;

use crate::app::App;

pub fn web_service() -> impl HttpServiceFactory {
    #[cfg(debug_assertions)]
    let files = Files::new("/", "dist").index_file("index.html");

    #[cfg(not(debug_assertions))]
    let files = Files::new("/", "static").index_file("index.html");

    files
}

pub fn web_config_js_service() -> impl HttpServiceFactory {
    services![config_js]
}
#[get("/config.js")]
async fn config_js(app: Data<App>) -> HttpResponse {
    let identity = app.domain_txt_identity();
    let config_json = match serde_json::to_string(&ConfigJs {
        path_prefix: app.config().web_server.url_path_prefix.clone(),
        default_settings: app.config().default_settings.clone().map(TsAny::from),
        computer_name: identity.and_then(|i| i.computer_name.clone()),
        public_ip: identity.and_then(|i| i.public_ip.clone()),
        machine_info_api_base: Some(app.config().web_server.machine_info_api_base.clone()),
    }) {
        Ok(value) => value,
        Err(err) => {
            warn!(
                "failed to create the web config.js. The Web Interface might fail to load! {err:?}"
            );

            return HttpResponse::InternalServerError().finish();
        }
    };
    let config_js = format!("export default {config_json}");

    HttpResponse::Ok()
        .append_header(("Content-Type", "text/javascript"))
        .body(config_js)
}
