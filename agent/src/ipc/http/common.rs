use axum::routing::MethodRouter;
use serde::{Deserialize, Serialize};

pub trait BaseRouter {
    fn get_path(&self) -> &'static str;
    fn get_handler(&self) -> fn() -> MethodRouter;
}

#[derive(Serialize)]
pub struct BaseResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize)]
pub struct InfoResponse {
    pub name: String,
    pub version: String,
    pub status: String,
}

#[derive(Deserialize)]
pub struct UpdateProcessRequest {
    pub process_id: u16,
    pub action: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct UpdateProcessResponse {
    pub success: bool,
    pub message: String,
}
