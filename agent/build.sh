#!/bin/bash

# 跨平台构建脚本
# 支持 Windows、macOS 和 Linux 平台
#
# 用法:
#   ./build.sh          # 编译当前平台
#   ./build.sh --cross  # 交叉编译当前平台 + Linux 平台 (需要交叉编译工具链)
#   ./build.sh --all    # 编译所有支持的平台 (需要交叉编译工具链)
#
# 注意: 在 macOS 上交叉编译 Linux 需要安装额外的工具链:
#   brew install FiloSottile/musl-cross/musl-cross

set -e

echo "开始跨平台构建 mitojs-agent..."

# 强制使用 rustup 工具链，避免 Homebrew rustc 的交叉编译问题
export PATH="$HOME/.cargo/bin:$PATH"

# 创建输出目录
mkdir -p ../packages/node/binaries

# 获取当前平台
CURRENT_OS=$(uname -s)
CURRENT_ARCH=$(uname -m)

# 检查是否指定了编译所有平台
if [[ "$1" == "--all" ]]; then
    echo "编译所有支持的平台..."
    TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin" "x86_64-unknown-linux-musl" "aarch64-unknown-linux-musl" "x86_64-pc-windows-gnu")
elif [[ "$1" == "--cross" ]]; then
    echo "交叉编译 macOS 和 Linux 平台..."
    if [[ "$CURRENT_OS" == "Darwin" ]]; then
        TARGETS=("aarch64-apple-darwin" x86_64-apple-darwin "x86_64-unknown-linux-musl" "aarch64-unknown-linux-musl")
    else
        TARGETS=("x86_64-unknown-linux-musl" "aarch64-unknown-linux-musl")
    fi
else
    # 根据当前平台确定目标
    if [[ "$CURRENT_OS" == "Darwin" ]]; then
        if [[ "$CURRENT_ARCH" == "arm64" ]]; then
            TARGETS=("aarch64-apple-darwin")
        else
            TARGETS=("x86_64-apple-darwin")
        fi
    elif [[ "$CURRENT_OS" == "Linux" ]]; then
        if [[ "$CURRENT_ARCH" == "aarch64" ]]; then
            TARGETS=("aarch64-unknown-linux-gnu")
        else
            TARGETS=("x86_64-unknown-linux-gnu")
        fi
    else
        # Windows 或其他平台，尝试本地编译
        echo "检测到未知平台，尝试本地编译..."
        TARGETS=()
    fi
fi

# 获取二进制文件名的函数
get_binary_name() {
    case "$1" in
        "x86_64-pc-windows-gnu")
            echo "mitojs-agent-win32-x64.exe"
            ;;
        "x86_64-unknown-linux-gnu")
            echo "mitojs-agent-linux-x64"
            ;;
        "aarch64-unknown-linux-gnu")
            echo "mitojs-agent-linux-arm64"
            ;;
        "x86_64-unknown-linux-musl")
            echo "mitojs-agent-linux-x64-musl"
            ;;
        "aarch64-unknown-linux-musl")
            echo "mitojs-agent-linux-arm64-musl"
            ;;
        "x86_64-apple-darwin")
            echo "mitojs-agent-darwin-x64"
            ;;
        "aarch64-apple-darwin")
            echo "mitojs-agent-darwin-arm64"
            ;;
        *)
            echo "unknown-binary"
            ;;
    esac
}

# 如果没有指定目标平台，进行本地编译
if [[ ${#TARGETS[@]} -eq 0 ]]; then
    echo "进行本地编译..."
    cargo +stable build --release --bin mitojs-agent
    
    # 复制到目标目录
    if [[ -f "target/release/mitojs-agent" ]]; then
        cp "target/release/mitojs-agent" "../packages/node/binaries/mitojs-agent-native"
        echo "✅ 本地编译成功: mitojs-agent-native"
    elif [[ -f "target/release/mitojs-agent.exe" ]]; then
        cp "target/release/mitojs-agent.exe" "../packages/node/binaries/mitojs-agent-native.exe"
        echo "✅ 本地编译成功: mitojs-agent-native.exe"
    else
        echo "❌ 本地编译失败"
    fi
    exit 0
fi

# 检查并安装目标平台
for target in "${TARGETS[@]}"; do
    echo "检查目标平台: $target"
    if ! rustup target list --installed | grep -q "$target"; then
        echo "安装目标平台: $target"
        rustup target add "$target"
    fi
done

# 编译各个平台
for target in "${TARGETS[@]}"; do
    echo "编译目标平台: $target"
    
    # 特殊处理 Windows 平台
    if [[ "$target" == "x86_64-pc-windows-gnu" ]]; then
        # 检查是否有 mingw-w64 工具链
        if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
            echo "警告: 未找到 mingw-w64 工具链，跳过 Windows 编译"
            echo "请安装: brew install mingw-w64 (macOS) 或 apt-get install gcc-mingw-w64 (Linux)"
            continue
        fi
    fi
    
    # 特殊处理 Linux musl 平台 (在 macOS 上)
    if [[ "$CURRENT_OS" == "Darwin" && "$target" == *"linux-musl"* ]]; then
        # 检查是否有 musl 交叉编译工具链
        if ! command -v musl-gcc &> /dev/null; then
            echo "警告: 未找到 musl 交叉编译工具链，跳过 $target 编译"
            echo "请安装: brew install FiloSottile/musl-cross/musl-cross"
            continue
        fi
    fi
    
    # 使用 rustup 工具链编译
    RUSTC=$(rustup which rustc) cargo +stable build --release --target="$target" --bin mitojs-agent
    
    # 复制二进制文件到目标目录
    source_path="target/$target/release/mitojs-agent"
    if [[ "$target" == "x86_64-pc-windows-gnu" ]]; then
        source_path="target/$target/release/mitojs-agent.exe"
    fi
    
    target_name=$(get_binary_name "$target")
    target_path="../packages/node/binaries/$target_name"
    
    if [[ -f "$source_path" ]]; then
        cp "$source_path" "$target_path"
        echo "✅ 成功编译: $target_name"
        
        # 显示文件大小
        if command -v ls &> /dev/null; then
            ls -lh "$target_path"
        fi
    else
        echo "❌ 编译失败: $target"
    fi
done

echo "构建完成！二进制文件位于: ../packages/node/binaries/"
echo "可用的二进制文件:"
ls -la ../packages/node/binaries/ 2>/dev/null || echo "未找到二进制文件目录"