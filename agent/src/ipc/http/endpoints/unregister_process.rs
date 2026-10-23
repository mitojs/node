use super::super::common::{BaseResponse, BaseRouter};
use crate::data_processor::store::PROCESS_MAP_STORE;
use axum::{
    extract::Json,
    response::Json as ResponseJson,
    routing::{post, MethodRouter},
};
use serde::Deserialize;

pub struct UnregisterProcessRouter;
impl BaseRouter for UnregisterProcessRouter {
    fn get_path(&self) -> &'static str {
        "/ipc/unregister_process"
    }
    fn get_handler(&self) -> fn() -> MethodRouter {
        || post(unregister_process)
    }
}
pub const UNREGISTER_PROCESS_ROUTER: UnregisterProcessRouter = UnregisterProcessRouter;
#[derive(Deserialize)]
struct UnregisterRequest {
    pid: u32,
}
async fn unregister_process(Json(request): Json<UnregisterRequest>) -> ResponseJson<BaseResponse> {
    // 注销只移除当前 PID，重复注销保持成功以便可靠地重试清理。
    PROCESS_MAP_STORE.remove(&request.pid);
    ResponseJson(BaseResponse {
        success: true,
        message: "ok".into(),
    })
}
