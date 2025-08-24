pub const AGENT_DIR: &str = "_mito_node_";
pub const UDS_SOCKET_NAME: &str = "_mito_node_.sock";
pub const AGENT_TCP_PORT: u16 = 16666;

#[derive(Debug, strum::EnumString, strum::Display)]
pub enum ListenerResultType {
    #[strum(serialize = "success")]
    Success,
    #[strum(serialize = "addr_in_use")]
    AddrInUse,
    FailedReason(String),
}

#[derive(Debug, serde::Serialize)]
pub enum IpcMessageCode {
    Ok = 200,
    Err = 500,
}
