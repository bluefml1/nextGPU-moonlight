use actix_web::{HttpResponse, get, web::Data};
use log::warn;
use serde::{Deserialize, Serialize};

use crate::app::App;

#[derive(Serialize)]
pub struct MachineInfoProxyResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_result: Option<f64>,
}

#[derive(Deserialize)]
struct GetMachineInfoApiResponse {
    success: Option<bool>,
    data: Option<GetMachineInfoData>,
}

#[derive(Deserialize)]
struct GetMachineInfoData {
    speed_result: Option<serde_json::Value>,
}

fn parse_speed_result(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

async fn fetch_speed_from_nextgpu_api(
    api_base: &str,
    public_ip: &str,
    computer_name: &str,
) -> Option<f64> {
    let base = api_base.trim_end_matches('/');
    let url = format!(
        "{base}/getMachineInfor?publicIP={}&computer_name={}",
        urlencoding::encode(public_ip),
        urlencoding::encode(computer_name),
    );

    let response = reqwest::get(&url).await.ok()?;
    if !response.status().is_success() {
        warn!(
            "getMachineInfor returned HTTP {} for publicIP={public_ip} computer_name={computer_name}",
            response.status()
        );
        return None;
    }

    let body: GetMachineInfoApiResponse = response.json().await.ok()?;
    if body.success != Some(true) {
        return None;
    }

    let data = body.data?;
    let raw = data.speed_result?;
    let speed = parse_speed_result(&raw)?;
    if speed.is_finite() && speed > 0.0 {
        Some((speed * 100.0).round() / 100.0)
    } else {
        None
    }
}

/// Same-origin proxy for profile gate — avoids browser CORS to API Gateway.
#[get("/machine-info")]
pub async fn get_machine_info(app: Data<App>) -> HttpResponse {
    let identity = match app.domain_txt_identity() {
        Some(i) => i,
        None => {
            return HttpResponse::Ok().json(MachineInfoProxyResponse {
                success: false,
                speed_result: None,
            });
        }
    };

    let public_ip = match identity.public_ip.as_deref() {
        Some(ip) if !ip.is_empty() => ip,
        _ => {
            return HttpResponse::Ok().json(MachineInfoProxyResponse {
                success: false,
                speed_result: None,
            });
        }
    };

    let computer_name = match identity.computer_name.as_deref() {
        Some(name) if !name.is_empty() => name,
        _ => {
            return HttpResponse::Ok().json(MachineInfoProxyResponse {
                success: false,
                speed_result: None,
            });
        }
    };

    let api_base = &app.config().web_server.machine_info_api_base;
    let speed_result =
        fetch_speed_from_nextgpu_api(api_base, public_ip, computer_name).await;

    HttpResponse::Ok().json(MachineInfoProxyResponse {
        success: speed_result.is_some(),
        speed_result,
    })
}
