#!/bin/bash

# ==========================================================
# AI 助手网络连通性诊断工具 (Codex/Antigravity)
# ==========================================================
# 使用方法：在终端直接运行 ./check_ai_network.sh
# ==========================================================

echo "================================================="
echo "     AI 助手网络连通性诊断工具开始运行"
echo "================================================="
echo ""

# ==========================================================
# 【代理配置说明】
# 如果您本地使用了代理客户端（例如 Clash, Surge, V2Ray），
# 且在终端中默认无法连接海外网络，请删除下方两行的 '#' 注释符号，
# 并将 7890 修改为您的实际代理端口。
# ==========================================================
# export https_proxy=http://127.0.0.1:7890
# export http_proxy=http://127.0.0.1:7890

# 1. 检查本地网关
echo "[1/3] 正在检查本地局域网连通性..."
GATEWAY=$(route -n get default 2>/dev/null | grep gateway | awk '{print $2}')
if [ -z "$GATEWAY" ]; then
    echo "  -> ⚠️ 警告：无法自动获取本地网关 IP。"
else
    # Mac 的 ping -t 是总体超时（秒）
    if ping -c 1 -t 2 "$GATEWAY" &> /dev/null; then
        echo "  -> ✅ 正常：成功连接到本地网关 ($GATEWAY)。"
    else
        echo "  -> ❌ 异常：无法连接本地网关，请检查您的 Wi-Fi 或网线！"
        echo "     (局域网诊断结束，后续网络可能均无法连通)"
    fi
fi
echo ""

# 2. 检查公网
echo "[2/3] 正在检查公网连通性 (8.8.8.8)..."
if ping -c 1 -t 2 8.8.8.8 &> /dev/null; then
    echo "  -> ✅ 正常：公网连接正常。"
else
    echo "  -> ❌ 异常：无法连接公网，请检查您的宽带或光猫状态！"
    echo "     (公网诊断结束，后续 API 可能无法连通)"
fi
echo ""

# 3. 检查 API 并分析耗时与状态码
echo "[3/3] 正在诊断 API 服务端状态..."

if [ -n "$https_proxy" ]; then
    echo "  (检测到您开启了终端代理变量: $https_proxy)"
fi

function test_api() {
    local name=$1
    local url=$2
    echo "-------------------------------------------------"
    echo "  >> 测试目标: $name"
    echo "     $url"
    
    # 使用 curl 获取状态码和时间指标
    # -m 10 : 最大超时时间 10 秒
    local result=$(curl -s -L -o /dev/null -m 10 -w "%{http_code}:%{time_namelookup}:%{time_connect}:%{time_appconnect}:%{time_starttransfer}:%{time_total}" "$url")
    
    if [ -z "$result" ]; then
        echo "  -> ❌ 异常：请求超时 (10s) 或无法连接到服务器网络。"
        return
    fi
    
    # 解析变量
    IFS=':' read -r http_code time_namelookup time_connect time_appconnect time_ttfb time_total <<< "$result"
    
    if [ "$http_code" = "000" ]; then
        echo "  -> ❌ 异常：无法建立连接。可能原因：网络被墙、代理配置失效、或者对方服务器彻底宕机。"
    else
        # 转换为毫秒
        local ttfb_ms=$(awk "BEGIN {printf \"%.0f\", $time_ttfb * 1000}")
        local total_ms=$(awk "BEGIN {printf \"%.0f\", $time_total * 1000}")
        
        # 诊断结果输出
        if [ "$http_code" = "429" ]; then
            echo "  -> ⚠️ 诊断：状态码 $http_code (Too Many Requests)。"
            echo "     原因：对方服务器判定您【请求过频】，开启了限流封控。请停止使用一段时间后再试。"
        elif [[ "$http_code" =~ ^5 ]]; then
            echo "  -> ⚠️ 诊断：状态码 $http_code (Server Error)。"
            echo "     原因：服务可达，但对方【服务器内部故障或宕机】，请等待官方修复。"
            echo "     耗时指标：首字节响应 ${ttfb_ms}ms，总耗时 ${total_ms}ms。"
        elif [[ "$http_code" =~ ^[234] ]]; then
            if [ "$ttfb_ms" -gt 3000 ]; then
                echo "  -> ⚠️ 诊断：状态码 $http_code，连接成功但【响应极慢】。"
                echo "     原因：对方【服务器极其繁忙】，或者您的代理节点严重拥堵。"
                echo "     耗时指标：首字节响应 ${ttfb_ms}ms，总耗时 ${total_ms}ms。"
            else
                echo "  -> ✅ 诊断：状态码 $http_code，服务【连接正常】。"
                echo "     耗时指标：首字节响应 ${ttfb_ms}ms，总耗时 ${total_ms}ms。"
            fi
        else
            echo "  -> ℹ️ 提示：状态码 $http_code，服务连通。首字节响应 ${ttfb_ms}ms。"
        fi
    fi
}

test_api "OpenAI (Codex)" "https://api.openai.com/"
test_api "Google Gemini (Antigravity)" "https://generativelanguage.googleapis.com/"
test_api "Anthropic Claude (Antigravity)" "https://api.anthropic.com/"

echo "-------------------------------------------------"
echo "诊断完成！"
echo "================================================="
