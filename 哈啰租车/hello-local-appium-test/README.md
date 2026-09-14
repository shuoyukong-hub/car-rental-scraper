# 哈啰租车本地真机 Appium 验证工程

目标：用一台 USB 连接的安卓手机验证哈啰 App 是否能通过 Appium 自动化进入租车查价链路，并判断价格字段能否直接读取。

## 本地需要的工具

- Java JDK 17
- Android Platform Tools，也就是 `adb`
- Node.js 和 npm
- Appium Server
- Appium UiAutomator2 Driver
- Python 3
- Appium Python Client

## 手机准备

1. 安卓手机开启开发者选项。
2. 开启 USB 调试。
3. 连接电脑后，在手机上允许 USB 调试授权。
4. 安装哈啰 App 或哈啰租车 App。
5. 登录测试账号。
6. 开启定位权限。
7. 人工确认可以进入：哈啰 App -> 哈啰租车 -> 城市/时间 -> 车型列表。

## 安装 Python 依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 检查设备

```bash
adb devices
```

看到 `device` 状态后再继续。

## 启动 Appium

```bash
appium --base-path /wd/hub
```

保持 Appium 终端运行，再开一个终端执行脚本。

## 运行探测脚本

```bash
cp config.example.json config.json
python run_local_probe.py --config config.json
```

脚本会连接本地 Appium，启动哈啰 App，保存页面 XML 和截图。

## 判断结果

- XML 中能看到“租车”“取车”“日租”等字样：说明 UI 文本可读，可以继续写自动点击和字段提取。
- 截图能看到价格但 XML 看不到：需要 OCR。
- App 无法启动：检查包名、Activity、账号权限或 Appium 环境。
