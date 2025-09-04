use axum::{
    response::Json as ResponseJson,
    routing::{get, MethodRouter},
};

use super::super::common::{BaseResponse, BaseRouter, InfoResponse};

pub struct InfoRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

impl BaseRouter for InfoRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }

    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

pub const INFO_ROUTER: InfoRouter = InfoRouter {
    path: "/info",
    handler: || get(get_info),
};

// GET /info 接口处理函数
async fn get_info() -> ResponseJson<InfoResponse> {
    let info = InfoResponse {
        name: "mitojs-agent".to_string(),
        version: "0.1.0".to_string(),
        status: "running".to_string(),
    };
    ResponseJson(info)
}
