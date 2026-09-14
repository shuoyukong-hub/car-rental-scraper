#!/bin/bash
# 微信小程序 API 抓包脚本
# 用法: bash capture_miniapp.sh
# 前提: 微信已登录，mitmproxy 已安装

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/captures/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTPUT_DIR"

echo "================================================"
echo "  微信小程序 API 抓包工具"
echo "  输出目录: $OUTPUT_DIR"
echo "================================================"
echo ""

# 1. 启动 mitmproxy
echo "[1/4] 启动 mitmproxy 代理 (端口 8080)..."
mitmdump -p 8080 -w "$OUTPUT_DIR/traffic.flow" \
    --set block_global=false \
    --ssl-insecure \
    &
MITM_PID=$!
sleep 2

# 检查 mitmproxy 是否启动成功
if ! kill -0 $MITM_PID 2>/dev/null; then
    echo "错误: mitmproxy 启动失败"
    exit 1
fi
echo "  mitmproxy PID: $MITM_PID"

# 2. 设置系统代理
echo "[2/4] 设置系统代理..."
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080

echo ""
echo "================================================"
echo "  代理已就绪。请手动完成以下操作:"
echo ""
echo "  1. 微信 → 搜索「哈啰」→ 进入小程序"
echo "  2. 点击「哈啰租车」"
echo "  3. 选择城市和时间"
echo "  4. 搜索车型"
echo "  5. 浏览几个车型的详情页"
echo ""
echo "  完成后回到终端按 Enter 键"
echo "================================================"
read -p ""

# 3. 停止抓包
echo "[3/4] 停止抓包..."
kill $MITM_PID 2>/dev/null
wait $MITM_PID 2>/dev/null

# 4. 提取 JSON 数据
echo "[4/4] 提取 API 请求数据..."
python3 "$SCRIPT_DIR/extract_apis.py" "$OUTPUT_DIR/traffic.flow" "$OUTPUT_DIR"

echo ""
echo "================================================"
echo "  完成! 数据保存在: $OUTPUT_DIR"
echo "  - traffic.flow    : 原始流量 (mitmproxy 格式)"
echo "  - api_requests.json: 提取的 API 请求"
echo "================================================"
