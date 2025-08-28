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

#[derive(Debug, Copy, Clone)]
pub enum IpcMessageCode {
    Ok = 200,
    Err = 500,
}

impl serde::Serialize for IpcMessageCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_i32(*self as i32)
    }
}
