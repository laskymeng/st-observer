# Tavern Observer (酒馆观测台)

> 一个放在 SillyTavern 里的 **只读旁观摄像头**：把测试时发生的事（消息收发、生成过程、提示词全文、世界书点亮、MVU 变量、报错）记录到本地，让 AI 助手随时翻"录像带"帮你复盘。

**纯只读 · 零侵入 · 零 AI 算力消耗 · 不连外网**

---

## 它是什么

三个组件，各管一事：

```
┌─────────────┐    POST      ┌──────────────┐    write    ┌──────────────┐
│  observer.js │ ───────────▶ │ phonebooth.py│ ──────────▶ │  logs/        │
│  摄像头       │  127.0.0.1:6701 │ 电话亭        │             │  录像带       │
│ (酒馆脚本库)  │              │ (本地接收器)  │             │ observe.log   │
└─────────────┘              └──────────────┘             │ prompts/*.txt │
                                                          └──────────────┘
```

- **摄像头** `observer.js`：装在酒馆助手脚本库，纯只读旁观，从不发起生成、不改数据。
- **电话亭** `phonebooth.py`：本地 HTTP 接收器（`127.0.0.1:6701`），把摄像头发来的记录落盘。
- **录像带** `logs/`：所有记录的存放处（`observe.log` 每行一条 JSON，`prompts/` 存每次生成的提示词全文）。

## 观测五路

| 路 | 内容 |
|---|---|
| ① 事件 | 消息收发（含 message_id 序列）、生成开始/结束/中止、删除/编辑 |
| ② 提示词 | 每次 AI 生成前的**提示词全文快照**（含角色卡设定、世界书注入、对话历史） |
| ③ 世界书 | 每次世界书点亮时的条目名（解决"点亮名单全是 ?"的排查痛点） |
| ④ 变量 | MVU 变量定时快照（默认 15s，可调），含聊天/消息/角色/全局四级 |
| ⑤ 报错 | 前端错误 / Promise 拒绝 / 事件断链 |

## 快速开始（3 步）

> 要求：SillyTavern + **酒馆助手**（Tavern Helper）扩展（4.8.2+）、Python 3、端口 6701 空闲。

1. **装摄像头**：酒馆 → 扩展 → 酒馆助手 → 脚本库（全局）→ 导入 `酒馆观测台_脚本包.json` → 打开脚本开关。
2. **开电话亭**：双击 `启动电话亭.bat`（黑窗口保持开着 = 正在录像）。
3. **复盘**：在 AI 对话里说"**看看记录**"，AI 会读 `logs/` 给你人话报告。配合下面的配套 skill 可让任意 AI 自动学会复盘。

> 备用方案：导入失败时，新建脚本 → 粘贴 `observer.js` 全文 → 打开开关。

## 配套 skill（让 AI 自动学会复盘）

仓库内 `skills/st-observer-review/` 是一张 AI agent 技能卡（面向 Pi / Claude Code 等 agent 系统）：AI 听到"看看记录 / 观测台 / 录像带"等触发词就自动读取日志、按五路框架复盘。

安装：

1. 把 `skills/st-observer-review/` 整个文件夹复制到你的 agent skills 目录
   （Pi：`~/.pi/agent/skills/`）。
2. 编辑 `SKILL.md`，把里面的 `<你的 st-observer 文件夹>` 改成你的实际路径（如 `D:/tools/st-observer`）。
3. 新对话里说"看看记录"即生效。

## 配置

| 项 | 位置 | 默认 |
|---|---|---|
| 电话亭端口 | `phonebooth.py` 顶部 `PORT` | `6701` |
| 变量快照间隔 | `observer.js` 顶部 `SNAPSHOT_INTERVAL_MS` | `15000` |
| Python 路径 | `启动电话亭.bat` 顶部注释 | 自动探测 `py`/`python`，可改自定义路径 |

## 隐私与安全

- **`logs/` 已被 `.gitignore` 排除**：聊天记录、提示词全文不会进入仓库。
- 所有通信都在本机回环（`127.0.0.1`），**零外联**。
- 摄像头只监听酒馆事件，从不发起生成：**零额外 AI 算力/API 消耗**。

## 开发者：记录格式

`logs/observe.log` 每行一条 JSON：

```json
{"ts": "2026-09-25 13:56:52.123", "kind": "event", "event": "收到AI消息", "message_id": 31, "char": "鬼作物语V6", "chat_id": "…"}
{"ts": "…", "kind": "prompt", "event": "chat_completion_prompt_ready", "file": "logs/prompts/1790315814257_e2zqvf.txt", "chars": 83888}
{"ts": "…", "kind": "worldinfo", "entries": [{"name": "服装描写强化"}, {"name": "瑞秋"}]}
{"ts": "…", "kind": "snapshot", "vars": {"chat": "…", "message": "…", "character": "…", "global": "…"}}
{"ts": "…", "kind": "error", "message": "…"}
```

`kind` 取值：`event` / `prompt` / `worldinfo` / `snapshot` / `error`。

监听的事件（酒馆事件名）：

- `message_sent` / `message_received` / `message_deleted`
- `GENERATION_STARTED` / `GENERATION_ENDED` / `GENERATION_STOPPED` / `GENERATION_AFTER_COMMANDS`
- `GENERATE_AFTER_COMBINE_PROMPTS`（text completion 提示词） / `CHAT_COMPLETION_PROMPT_READY`（chat completion 提示词）
- `WORLD_INFO_ACTIVATED` / `APP_READY` 等

## 已知现象（非 bug）

- `dry_run=true` 的生成开始 = 酒馆预演（不发结束事件），正常。
- `type=quiet` 的生成开始 = 消息编辑等内部静默生成，正常。
- 同一 message_id 两条"生成结束" = 更新/滑动二次触发，正常。

## 许可

[MIT](LICENSE) © 2026 见 LICENSE 文件。

---

**给非程序员看的完整操作指南见 [`使用说明书.md`](使用说明书.md)。**
