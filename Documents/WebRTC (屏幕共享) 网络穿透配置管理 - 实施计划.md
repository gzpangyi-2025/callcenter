# WebRTC (屏幕共享) 网络穿透配置管理 - 实施计划

## 目标
建立一个全栈的管理模块，允许管理员动态配置屏幕共享底层的 STUN/TURN 服务器。提供对“国内免费开源 STUN”与“私有化部署 STUN/TURN”模式的切换能力，彻底解决由于硬编码 Google STUN 导致的国内互联网用户黑屏问题。

## Proposed Changes

### 1. 后端接口扩展 (Backend)
**[MODIFY] `backend/src/modules/settings/settings.controller.ts`**
- 新增 `saveWebRtc` (POST `settings/webrtc`)：接收并保存 WebRTC 配置，包括工作模式 (`mode`)、自定义 STUN 地址 (`customStun`)、自定义 TURN 地址及账号密码 (`customTurn`, `turnUsername`, `turnPassword`)。
- 新增 `getWebRtcConfig` (GET `settings/webrtc-config`)：专门为前端屏幕共享组件提供服务。
  - 如果 `mode === 'auto'`，直接返回内置的国内高可用免费 STUN 列表（腾讯云、小米等）。
  - 如果 `mode === 'custom'`，则组装并返回管理员配置的 `customStun` 和 `customTurn` 节点。

### 2. 前端 API 绑定 (Frontend API)
**[MODIFY] `frontend/src/services/api.ts`**
- 在 `settingsAPI` 中补充 `saveWebRtc(data)` 和 `getWebRtcConfig()` 两个方法。

### 3. 前端管理界面 (Frontend UI)
**[NEW] `frontend/src/pages/Admin/components/WebRtcManageTab.tsx`**
- 创建全新的设置面板页，分为三个区域：
  1. **技术原理解释区**：以友好的图文或文本卡片形式，向管理员解释 STUN/TURN 的区别及为什么需要穿透。
  2. **模式选择区**：使用 `Radio.Group` 提供两种模式：
     - **自动模式 (推荐)**：自动下发国内大厂（腾讯、小米等）的高可用公共 STUN。
     - **自建私有化模式**：提供高级表单。
  3. **高级配置表单**：当选中私有化模式时，显示 STUN 服务器 IP/域名，以及 TURN 服务器的 URI、用户名、密码输入框。

**[MODIFY] `frontend/src/pages/Admin/index.tsx`**
- 引入 `<WebRtcManageTab />`，在侧边栏新增一个名为“WebRTC (屏幕共享)”的设置入口。

### 4. 屏幕共享核心组件对接 (Frontend WebRTC Hook)
**[MODIFY] `frontend/src/hooks/useScreenShare.ts`**
- 移除硬编码的 Google STUN 列表。
- 在组件初始化时（或当需要建立连接前），异步调用 `settingsAPI.getWebRtcConfig()`。
- 将后端返回的 `RTCIceServer[]` 注入到 `new RTCPeerConnection({ iceServers })` 的配置中。

## User Review Required
> [!IMPORTANT]
> 由于修改了 `useScreenShare.ts`，获取服务器配置需要一次极快（几毫秒）的网络请求。这会在点击“屏幕共享”时引入微小的几乎无感的延迟（因为需要等后端返回 IP 列表），但这换来的是极高的灵活性。您是否同意此异步获取的设计？

## Verification Plan
1. **构建与部署**：执行 `npm run build` 确保前后端编译无误。
2. **管理后台验证**：进入系统设置，验证 WebRTC 配置页能否正常加载、保存，以及不同模式的切换逻辑是否顺畅。
3. **接口验证**：通过浏览器抓包或日志，确认请求 `getWebRtcConfig` 返回了正确的 `urls` 数组。
