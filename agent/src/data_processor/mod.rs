pub mod store;
// 旧消息格式仅保留回归测试，不再启动未接通的 UDS/TCP 指令链路。
#[cfg(test)]
mod subscribe;

#[cfg(test)]
mod tests;
