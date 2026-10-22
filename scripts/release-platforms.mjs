// Rust 编译目标与 SDK 的运行时文件名必须一致；Windows 只提供 x64 MSVC 产物。
export const releasePlatforms = [
	{ target: 'aarch64-apple-darwin', filename: 'mitojs-agent-darwin-arm64' },
	{ target: 'x86_64-apple-darwin', filename: 'mitojs-agent-darwin-x64' },
	{ target: 'x86_64-unknown-linux-musl', filename: 'mitojs-agent-linux-x64-musl' },
	{ target: 'aarch64-unknown-linux-musl', filename: 'mitojs-agent-linux-arm64-musl' },
	{ target: 'x86_64-pc-windows-msvc', filename: 'mitojs-agent-win-x64.exe' },
]
