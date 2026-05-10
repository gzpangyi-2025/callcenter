// You can switch this base URL depending on which environment you want to test against.

// 1. 本地 macOS 测试环境 (因处于局域网网段，iOS/Android 允许不带 SSL 的 HTTP 请求)
export const LOCAL_MAC_API_URL = 'http://192.168.50.39:3000/api';

// 2. 本地测试服务器 (带有业务数据的服务器，同属局域网，不验证 SSL)
export const LOCAL_TEST_API_URL = 'http://192.168.50.51/api';

// 当前激活的环境：切换到有数据的 51 服务器
export const API_BASE_URL = LOCAL_TEST_API_URL;
