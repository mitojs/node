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

set -eo pipefail

# 颜色定义
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

log_success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

log_error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

# 配置常量
readonly OUTPUT_DIR="../packages/node/binaries"
readonly BINARY_NAME="mitojs-agent"

# 目标平台配置 - 使用普通数组替代关联数组以提高兼容性
TARGET_CONFIGS=(
    "x86_64-pc-windows-gnu:mitojs-agent-win32-x64.exe"
    "x86_64-unknown-linux-musl:mitojs-agent-linux-x64-musl"
    "aarch64-unknown-linux-musl:mitojs-agent-linux-arm64-musl"
    "x86_64-apple-darwin:mitojs-agent-darwin-x64"
    "aarch64-apple-darwin:mitojs-agent-darwin-arm64"
)

# 获取当前平台信息
get_current_platform() {
    local os=$(uname -s)
    local arch=$(uname -m)
    echo "$os:$arch"
}

# 根据平台确定目标
determine_targets() {
    local build_mode="$1"
    local current_platform=$(get_current_platform)
    local os=$(echo "$current_platform" | cut -d: -f1)
    local arch=$(echo "$current_platform" | cut -d: -f2)
    
    case "$build_mode" in
        "--all")
            echo "aarch64-apple-darwin x86_64-apple-darwin x86_64-unknown-linux-musl aarch64-unknown-linux-musl x86_64-pc-windows-gnu"
            ;;
        "--cross")
            if [[ "$os" == "Darwin" ]]; then
                echo "aarch64-apple-darwin x86_64-apple-darwin x86_64-unknown-linux-musl aarch64-unknown-linux-musl"
            else
                echo "x86_64-unknown-linux-musl aarch64-unknown-linux-musl"
            fi
            ;;
        *)
            # 本地编译
            if [[ "$os" == "Darwin" ]]; then
                if [[ "$arch" == "arm64" ]]; then
                    echo "aarch64-apple-darwin"
                else
                    echo "x86_64-apple-darwin"
                fi
            elif [[ "$os" == "Linux" ]]; then
                if [[ "$arch" == "aarch64" ]]; then
                    echo "aarch64-unknown-linux-musl"
                else
                    echo "x86_64-unknown-linux-musl"
                fi
            else
                echo ""
            fi
            ;;
    esac
}

# 获取二进制文件名
get_binary_name() {
    local target="$1"
    local binary_name="unknown-binary"
    
    for config in "${TARGET_CONFIGS[@]}"; do
        local config_target=$(echo "$config" | cut -d: -f1)
        if [[ "$config_target" == "$target" ]]; then
            binary_name=$(echo "$config" | cut -d: -f2)
            break
        fi
    done
    
    echo "$binary_name"
}

# 检查工具链依赖
check_toolchain_dependencies() {
    local target="$1"
    local current_os=$(uname -s)
    
    case "$target" in
        "x86_64-pc-windows-gnu")
            if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
                log_warning "未找到 mingw-w64 工具链，跳过 Windows 编译"
                log_info "请安装: brew install mingw-w64 (macOS) 或 apt-get install gcc-mingw-w64 (Linux)"
                return 1
            fi
            ;;
        *"linux-musl")
            if [[ "$current_os" == "Darwin" ]]; then
                if ! command -v musl-gcc &> /dev/null; then
                    log_warning "未找到 musl 交叉编译工具链，跳过 $target 编译"
                    log_info "请安装: brew install FiloSottile/musl-cross/musl-cross"
                    return 1
                fi
            fi
            ;;
    esac
    return 0
}

# 安装目标平台
install_target() {
    local target="$1"
    log_info "检查目标平台: $target"
    
    if ! rustup target list --installed | grep -q "$target"; then
        log_info "安装目标平台: $target"
        rustup target add "$target"
    fi
}

# 编译单个目标
compile_target() {
    local target="$1"
    log_info "编译目标平台: $target"
    
    # 检查依赖
    if ! check_toolchain_dependencies "$target"; then
        return 1
    fi
    
    # 编译
    if RUSTC=$(rustup which rustc) cargo +stable build --release --target="$target" --bin "$BINARY_NAME"; then
        # 复制二进制文件
        local source_path="target/$target/release/$BINARY_NAME"
        if [[ "$target" == "x86_64-pc-windows-gnu" ]]; then
            source_path="target/$target/release/$BINARY_NAME.exe"
        fi
        
        local target_name=$(get_binary_name "$target")
        local target_path="$OUTPUT_DIR/$target_name"
        
        if [[ -f "$source_path" ]]; then
            cp "$source_path" "$target_path"
            log_success "成功编译: $target_name"
            ls -lh "$target_path"
            return 0
        else
            log_error "编译失败: 找不到输出文件 $source_path"
            return 1
        fi
    else
        log_error "编译失败: $target"
        return 1
    fi
}

# 本地编译
compile_native() {
    log_info "进行本地编译..."
    
    if cargo +stable build --release --bin "$BINARY_NAME"; then
        local source_path="target/release/$BINARY_NAME"
        local target_path="$OUTPUT_DIR/mitojs-agent-native"
        
        if [[ -f "$source_path" ]]; then
            cp "$source_path" "$target_path"
            log_success "本地编译成功: mitojs-agent-native"
            return 0
        elif [[ -f "target/release/$BINARY_NAME.exe" ]]; then
            cp "target/release/$BINARY_NAME.exe" "$OUTPUT_DIR/mitojs-agent-native.exe"
            log_success "本地编译成功: mitojs-agent-native.exe"
            return 0
        else
            log_error "本地编译失败: 找不到输出文件"
            return 1
        fi
    else
        log_error "本地编译失败"
        return 1
    fi
}

# 显示构建结果
show_build_results() {
    log_info "构建完成！二进制文件位于: $OUTPUT_DIR/"
    log_info "可用的二进制文件:"
    
    if [[ -d "$OUTPUT_DIR" ]]; then
        ls -la "$OUTPUT_DIR/"
    else
        log_warning "未找到二进制文件目录"
    fi
}

# 主函数
main() {
    log_info "开始跨平台构建 mitojs-agent..."
    
    # 强制使用 rustup 工具链，避免 Homebrew rustc 的交叉编译问题
    export PATH="$HOME/.cargo/bin:$PATH"
    
    # 创建输出目录
    mkdir -p "$OUTPUT_DIR"
    
    # 确定目标平台
    local targets_str=$(determine_targets "${1:-}")
    local targets=()
    
    # 安全地解析目标字符串
    if [[ -n "$targets_str" ]]; then
        IFS=' ' read -ra targets <<< "$targets_str"
    fi
    
    # 如果没有指定目标平台，进行本地编译
    if [[ ${#targets[@]} -eq 0 ]]; then
        compile_native
        show_build_results
        exit 0
    fi
    
    # 安装目标平台
    for target in "${targets[@]}"; do
        if [[ -n "$target" ]]; then
            install_target "$target"
        fi
    done
    
    # 编译各个平台
    local success_count=0
    local total_count=0
    
    for target in "${targets[@]}"; do
        if [[ -n "$target" ]]; then
            ((total_count++))
            if compile_target "$target"; then
                ((success_count++))
            fi
        fi
    done
    
    # 显示结果
    log_info "编译完成: $success_count/$total_count 个目标成功"
    show_build_results
    
    # 如果有失败的编译，返回非零退出码
    if [[ $success_count -lt $total_count ]]; then
        exit 1
    fi
}

# 脚本入口
main "$@"