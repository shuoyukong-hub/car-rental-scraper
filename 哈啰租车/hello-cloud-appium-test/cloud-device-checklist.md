# 云真机执行检查表

## 先人工远程验证

1. 进入云真机控制台，选择 Android 真机。
2. 安装哈啰 App 或哈啰租车 App。
3. 登录测试账号。
4. 开启定位权限。
5. 手工进入：哈啰 App -> 哈啰租车 -> 城市/时间 -> 车型列表。
6. 截图确认是否能看到日租价和总价。

## 再接 Appium

1. 获取云真机平台的 Appium/WebDriver 远程地址。
2. 获取设备 capabilities 示例。
3. 将地址和 capabilities 填入 `config.json`。
4. 运行 `python run_hello_probe.py --config config.json`。
5. 查看 `outputs` 目录下的 XML 和截图。

## 判断采集方式

- XML 中能看到车型和价格：优先用 Appium 直接读取 UI 文本。
- XML 中看不到价格但截图能看到：使用 OCR。
- 截图也不到价格：说明流程未到车型页，需要补自动点击步骤。

## 需要记录的结果

- 云真机平台名称。
- 设备品牌、型号、Android 版本。
- 哈啰 App 版本。
- 是否需要登录。
- 是否需要实名认证。
- 是否需要定位。
- 是否触发验证码/风控。
- 价格字段是否可从 XML 读取。
- 是否需要 OCR。
