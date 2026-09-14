# 哈啰租车云真机 Appium 验证工程

目标：验证哈啰 App 在云真机上是否能自动进入租车查价链路，并采集车型列表页/订单页价格信息。

## 推荐云真机平台

优先级：

1. 百度 MTC：官方说明支持远程真机、Appium、UIAutomator、微信小程序/公众号/H5 脚本测试。
2. 阿里云移动测试：官方说明支持 Python Appium 脚本，在线录制脚本默认为 Python Appium。
3. 腾讯云远程调试 RD：官方说明支持远程真机、ADB 模式和自动化测试，适合先人工远程验证。

## 云真机侧需要准备

- Android 云真机 1 台，建议 Android 10-13。
- 可安装哈啰 App 或哈啰租车 App。
- 哈啰测试账号，提前完成登录、定位授权、必要认证。
- 云真机平台提供的 Appium/WebDriver 远程地址。
- 如平台要求，需要上传 APK 或在设备中手动安装应用。

## 本地脚本环境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json
```

编辑 `config.json`，填入云真机平台提供的 `remote_url`、设备能力和哈啰 App 包名。

## 运行

```bash
python run_hello_probe.py --config config.json
```

脚本会做三件事：

- 连接云真机 Appium 服务；
- 启动哈啰 App；
- 保存页面 XML 和截图，用于判断页面控件是否可直接读取价格。

第一轮不强行自动下单，只验证自动化可达性和价格字段可读性。

## 验证通过标准

- 可以稳定启动哈啰 App。
- 可以进入“哈啰租车”入口。
- 可以设置城市和取还时间。
- 可以进入车型列表页。
- 车型名称、日租价、总价至少一种可通过 UI 文本或 OCR 获取。

## 失败分类

- 环境失败：云真机不能安装/启动哈啰 App。
- 账号失败：登录、实名认证、定位授权、验证码阻断。
- 自动化失败：Appium 无法识别控件或页面频繁变化。
- 采集失败：页面能打开，但价格只能以图片/复杂控件展示，需要 OCR。
