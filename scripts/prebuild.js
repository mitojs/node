#!/usr/bin/env node

/**
 * 预构建脚本
 * 用于在 npm 发布前自动构建所有平台的二进制文件
 */

const { execSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const path = require('path')

const AGENT_DIR = path.join(__dirname, '..', 'agent')
const NODE_PACKAGE_DIR = path.join(__dirname, '..', 'packages', 'node')
const BINARIES_DIR = path.join(NODE_PACKAGE_DIR, 'binaries')

/**
 * 执行命令并输出结果
 */
function execCommand(command, cwd = process.cwd()) {
	console.log(`执行命令: ${command}`)
	console.log(`工作目录: ${cwd}`)

	try {
		const result = execSync(command, {
			cwd,
			stdio: 'inherit',
			encoding: 'utf8',
		})
		return result
	} catch (error) {
		console.error(`命令执行失败: ${error.message}`)
		process.exit(1)
	}
}

/**
 * 检查必要的工具
 */
function checkPrerequisites() {
	console.log('检查构建环境...')

	// 检查 Rust
	try {
		execSync('rustc --version', { stdio: 'pipe' })
		console.log('✅ Rust 已安装')
	} catch (error) {
		console.error('❌ 未找到 Rust，请先安装 Rust: https://rustup.rs/')
		process.exit(1)
	}

	// 检查 Cargo
	try {
		execSync('cargo --version', { stdio: 'pipe' })
		console.log('✅ Cargo 已安装')
	} catch (error) {
		console.error('❌ 未找到 Cargo')
		process.exit(1)
	}

	// 检查 agent 目录
	if (!existsSync(AGENT_DIR)) {
		console.error(`❌ 未找到 agent 目录: ${AGENT_DIR}`)
		process.exit(1)
	}

	console.log('✅ 构建环境检查通过')
}

/**
 * 创建必要的目录
 */
function createDirectories() {
	console.log('创建必要的目录...')

	if (!existsSync(BINARIES_DIR)) {
		mkdirSync(BINARIES_DIR, { recursive: true })
		console.log(`✅ 创建目录: ${BINARIES_DIR}`)
	}
}

/**
 * 安装 Rust 目标平台
 */
function installRustTargets() {
	console.log('安装 Rust 目标平台...')

	const targets = [
		'x86_64-pc-windows-gnu',
		'x86_64-unknown-linux-gnu',
		'aarch64-unknown-linux-gnu',
		'x86_64-apple-darwin',
		'aarch64-apple-darwin',
	]

	for (const target of targets) {
		try {
			// 检查是否已安装
			const installed = execSync('rustup target list --installed', {
				stdio: 'pipe',
				encoding: 'utf8',
			})

			if (!installed.includes(target)) {
				console.log(`安装目标平台: ${target}`)
				execSync(`rustup target add ${target}`, { stdio: 'inherit' })
			} else {
				console.log(`✅ 目标平台已安装: ${target}`)
			}
		} catch (error) {
			console.warn(`⚠️  安装目标平台失败: ${target}`)
		}
	}
}

/**
 * 构建二进制文件
 */
function buildBinaries() {
	console.log('开始构建二进制文件...')

	const buildScript = path.join(AGENT_DIR, 'build.sh')

	if (!existsSync(buildScript)) {
		console.error(`❌ 未找到构建脚本: ${buildScript}`)
		process.exit(1)
	}

	// 确保构建脚本有执行权限
	execCommand(`chmod +x ${buildScript}`)

	// 执行构建
	execCommand('./build.sh', AGENT_DIR)

	console.log('✅ 二进制文件构建完成')
}

/**
 * 验证构建结果
 */
function validateBuild() {
	console.log('验证构建结果...')

	const expectedBinaries = [
		'mitojs-agent-win32-x64.exe',
		'mitojs-agent-linux-x64',
		'mitojs-agent-linux-arm64',
		'mitojs-agent-darwin-x64',
		'mitojs-agent-darwin-arm64',
	]

	let successCount = 0

	for (const binary of expectedBinaries) {
		const binaryPath = path.join(BINARIES_DIR, binary)
		if (existsSync(binaryPath)) {
			console.log(`✅ ${binary}`)
			successCount++
		} else {
			console.log(`❌ ${binary} (未找到)`)
		}
	}

	console.log(`\n构建结果: ${successCount}/${expectedBinaries.length} 个二进制文件`)

	if (successCount === 0) {
		console.error('❌ 没有成功构建任何二进制文件')
		process.exit(1)
	} else if (successCount < expectedBinaries.length) {
		console.warn('⚠️  部分二进制文件构建失败，但至少有一个成功')
	} else {
		console.log('🎉 所有二进制文件构建成功！')
	}
}

/**
 * 主函数
 */
function main() {
	console.log('🚀 开始预构建流程...')
	console.log('='.repeat(50))

	try {
		checkPrerequisites()
		createDirectories()
		installRustTargets()
		buildBinaries()
		validateBuild()

		console.log('='.repeat(50))
		console.log('🎉 预构建流程完成！')
	} catch (error) {
		console.error('❌ 预构建流程失败:', error.message)
		process.exit(1)
	}
}

// 如果直接运行此脚本
if (require.main === module) {
	main()
}

module.exports = { main }
