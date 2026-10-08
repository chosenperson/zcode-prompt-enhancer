# ZCode Prompt Enhancer

为 **Windows 版 ZCode** 添加输入框底部的提示词增强按钮、独立模型选择、思考强度、停止等待及原生撤销。

**不需要 Codex、AI 助手、Git、Node.js 或手工配置 API Key。** 下载并解压后双击 `INSTALL.cmd`，即可安装并注册桌面启动入口。未找到 Python 3.10+ 时，安装器自动从 Python 官网下载带固定 SHA-256 校验的便携运行环境。

这是一款非官方、本地补丁工具，不是 ZCode 的官方插件，也不代表 WorkBuddy 或 Augment。它仅适配下面列出的 Windows 构建，不承诺任意版本通用。

## 一键安装

1. 从 [Releases](https://github.com/chosenperson/zcode-prompt-enhancer/releases) 下载最新 ZIP，解压整个目录。
2. 保存草稿并完全退出 ZCode，包括托盘中的后台进程。
3. 双击 **`INSTALL.cmd`**。首次运行可能需要联网下载约 12 MB 的官方便携 Python。
4. 安装成功后正常打开 ZCode，或使用桌面的 **ZCode Prompt Enhancer** 快捷方式。

安装器会把工具及备份保存在 `%LOCALAPPDATA%\ZCodePromptEnhancer`，因此安装成功后可以移动或删除下载的解压目录。它不会强杀 ZCode，不会改系统执行策略，也不需要向任何额外服务提供密钥。

默认检测 `%LOCALAPPDATA%\Programs\ZCode`。自定义安装位置时，在解压目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Action Install -ZCodePath "D:\Apps\ZCode"
```

`-NoShortcut` 可只装补丁、不创建桌面入口；`-Offline` 禁止自动下载运行环境。无写入安装目录权限时会明确失败，不自动提权。

## 使用

- 单击输入框底部「✧ 增强」，处理当前草稿，结果回填后由你检查并发送。
- 点击旁边的「⌄」或右键增强按钮，选择 **标准增强 / 创意增强**、**增强模型**和**思考强度**。
- 模型列表复用当前工作区的 ZCode 配置，按供应商分组，无需另外填写密钥。
- 模型和思考选择按工作区及远端身份保存；增强模型独立于聊天模型。新选模型优先使用其支持的较低思考强度，可自行调整。
- 「跟随工作区默认模型」清除独立选择，恢复使用 ZCode 的首选模型及其思考选项。
- 点击增强中的按钮可停止等待；结果不会覆盖你后来修改的草稿。成功后可用面板里的撤销，或原生撤销/重做。
- 同时隐藏侧栏账号名旁的订阅等级徽标；不改变订阅数据、服务端权益、账号菜单或设置页。

公开版使用本项目自写的标准/创意模板，未打包第三方分享包的模板原文。模式标识沿用早期本地版本以兼容偏好，但「标准增强」不宣称与 WorkBuddy 原版模板相同。

## 兼容范围

| ZCode Windows 版本 | 增强按钮 | 独立模型/思考选择 |
| --- | --- | --- |
| 3.14.4 | 支持，当前验证版本 | 支持 |
| 3.14.1 / 3.14.0 | 已有版本映射 | 支持原生 selection 协议 |
| 3.12.1 / 3.11.2 | 已有版本映射 | 使用工作区默认模型 |

安装器同时检查 **版本号和官方原包 SHA-256**。同版本的不同构建、未知版本、损坏的备份或其他工具改过的包都会停止。最新功能的真实发布组件界面测试针对 3.14.4，其他映射不代表每次发布都在相应版本中重新实测。

ZCode 更新可能覆盖补丁。使用桌面增强版入口或 `LAUNCH.cmd` 时，会为已适配构建重新安装；同一补丁不会重复替换。未知构建需先适配，不能拿旧版 app.asar 覆盖新版。

## 回滚与备份

保存草稿并完全退出 ZCode，双击 **`ROLLBACK.cmd`**，恢复当前版本的官方原包。恢复后使用普通 ZCode 快捷方式；再次使用增强版入口会按设计重新安装补丁。

原包、候选及校验清单位于：

```text
%LOCALAPPDATA%\ZCodePromptEnhancer\packages\<ZCode版本>\<原包SHA256>\
```

不要手工删除这个目录，否则会失去安全重建/回滚所需的原包或已校验候选。保留它也能让新下载的版本继续识别旧补丁。

高级命令（使用已安装的 Python）：

```powershell
python .\inject.py --list-supported
python .\inject.py                             # 只构建检查，不替换程序
python .\inject.py --apply                     # 安装
python .\inject.py --rollback                  # 同版本回滚
python .\inject.py --target "D:\Apps\ZCode\resources\app.asar" --data-dir "D:\Backups\ZCodeEnhancer" --apply
```

`--data-dir` 要在后续更新和回滚时保持一致。老的本地脚本用户请把原包及匹配的已安装候选一起保留，或显式指定原备份目录；安装器不会根据包内的任意文件路径读取备份。

## 数据与使用边界

增强通过 ZCode 的独立文本生成接口，将当前草稿和增强模板发送给你选择的模型服务，可能消耗额度。补丁不主动读取聊天历史、附件内容或项目文件；含文件/技能引用或特殊格式的草稿会拒绝自动增强。

停止等待保证不回填，不保证底层服务取消或停止计费。改稿、切换任务、输入法编辑或编辑器失效时，会保留草稿；最近结果只在当前页面内存中保留。模型或思考选项失效时提示重选，不静默改用别的模型。

这里没有真实供应商测速结果；Flash 等名称不等于实测速度。模型输出仍需你检查后发送。

## 开发与验证

运行时仅需要 Python 标准库。Node.js 只用于开发测试：

```powershell
node .\test-core.mjs
node .\test-model.mjs
python .\test-inject.py
```

测试涵盖草稿保护、模型选择及存储隔离、安装/重复运行/回滚、未知构建与修改冲突的拒绝路径。使用本机合法安装包及原包备份，可执行 `python .\prepare-ui-test.py 3.14.4`，再通过仅绑定 `127.0.0.1` 的 HTTP 服务打开生成的 `index.html` 和 `model-picker.html`，验证真实 React/Lexical 与模拟模型的 8 + 20 项交互。

测试提取的 ZCode 发布资产及 app.asar **不随源码或 Release 分发**。模拟模型测试不等于真实模型连通性和速度验收。

便携运行环境固定为 [Python 3.14.8 官方 Windows embeddable package](https://www.python.org/downloads/release/python-3148/)，下载 SHA-256 为 `a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310`。运行环境保留其自带许可。

## 许可

本仓库原创代码及提示模板采用 [MIT License](LICENSE)。ZCode 本体、其发布资产与商标不在该许可范围内。项目灵感及分发边界见 [NOTICE.md](NOTICE.md)。
