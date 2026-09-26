/**
 * ============================================================
 *  酒馆观测台 · 观测脚本（摄像头）
 *  ============================================================
 *  把这个脚本粘贴进 酒馆助手 → 脚本库 → 全局脚本库 里保存，
 *  它就会开始"只看不动"地记录酒馆里发生的事。
 *
 *  它做什么：
 *    - 监听酒馆的内部广播（事件）：谁发了消息、AI 回了什么、
 *      世界书亮没亮、生成开没开始/结没结束、有没有报错
 *    - 把每条观测记录通过 HTTP 发给本地的"电话亭"
 *      （phonebooth.py，监听 127.0.0.1:6701）
 *
 *  它不做什么：
 *    - 不发送任何消息、不修改任何东西、不调用 AI
 *    - 纯粹旁观
 *
 *  使用前提：电话亭正在运行（先双击启动 phonebooth.py 的那个窗口）
 * ============================================================
 */

// ====================== 配置区（想改可改） ======================
const PHONEBOOTH_URL = 'http://127.0.0.1:6701/ingest';   // 电话亭地址
const SNAPSHOT_INTERVAL = 15;                            // 每隔多少秒自动拍一张"状态快照"（变量等）
const MAX_VARS_LENGTH = 4000;                            // 变量快照最多记多长（防止太长）
// ==============================================================

// ---------- 小工具：把一条记录发给电话亭 ----------
// 电话亭没开时静默失败（不打扰酒馆），但会留一条 console 日志方便排查
async function sendToPhonebooth(payload) {
  try {
    await fetch(PHONEBOOTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.info('[观测台] 电话亭未连接（忽略）：', err.message);
  }
}

// ---------- 小工具：截断长文本 ----------
function clip(text, max) {
  if (typeof text !== 'string') {
    try { text = JSON.stringify(text); } catch { text = String(text); }
  }
  return text.length > max ? text.slice(0, max) + '…[截断]' : text;
}

// ---------- 小工具：拿酒馆的完整上下文 ----------
// 直接拿 SillyTavern.getContext() 的原始返回值（含 eventSource / eventTypes 等）
function getRawContext() {
  try {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
      return SillyTavern.getContext();
    }
  } catch (err) { /* 拿不到就用空 */ }
  return null;
}

// ---------- 小工具：拿当前聊天/角色信息 ----------
function getCurrentContext() {
  const ctx = getRawContext();
  if (!ctx) return { chat_id: '?', char_name: '?' };
  const chatId = ctx.chatId || ctx.chat?.id || '?';
  const charName = ctx.characters?.[0]?.name || ctx.characterId !== undefined
    ? (ctx.characters?.[ctx.characterId]?.name || '?')
    : '?';
  return { chat_id: chatId, char_name: charName };
}

// ---------- 小工具：注册事件监听（关键修正） ----------
// 优先直连酒馆主页的事件总线（SillyTavern.getContext().eventSource）：
// 这是酒馆官方给的入口，事件数据原样到达，不会被酒馆助手的
// 面板 iframe 桥接层"掏空"（历史 bug：提示词/世界书内容变空）。
// 只有拿不到官方入口时才退回酒馆助手的 eventOn 桥接。
function safeOn(evtName, handler) {
  const ctx = getRawContext();
  if (ctx && ctx.eventSource && typeof ctx.eventSource.on === 'function') {
    try {
      ctx.eventSource.on(evtName, handler);
      return;
    } catch (err) { /* 退回桥接 */ }
  }
  if (typeof eventOn === 'function') {
    try { eventOn(evtName, handler); } catch (err) { /* 忽略 */ }
  }
}

// ---------- 小工具：拍变量快照 ----------
// 把当前聊天变量、消息变量、角色变量抄一份发给电话亭
function snapshotVariables(reason) {
  const ctx = getCurrentContext();
  const vars = {};
  try { vars.chat = getVariables({ type: 'chat' }); } catch { /* 没聊天变量 */ }
  try { vars.message = getVariables({ type: 'message' }); } catch { /* 没消息变量 */ }
  try { vars.character = getVariables({ type: 'character' }); } catch { /* 没角色变量 */ }
  try { vars.global = getVariables({ type: 'global' }); } catch { /* 没全局变量 */ }

  sendToPhonebooth({
    kind: 'vars',
    scope: '快照',
    reason,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
    variables: clip(vars, MAX_VARS_LENGTH),
  });
}

// ====================== 监听酒馆广播 ======================

// -- 1. 你发了消息 --
safeOn('message_sent', (message_id) => {
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'event',
    event: '你发送了消息',
    message_id,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
  });
});

// -- 2. AI 回了消息（含继续/重生成/滑动等类型） --
safeOn('message_received', (message_id, type) => {
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'event',
    event: '收到AI消息',
    message_id,
    type,                      // normal / continue / regenerate / swipe ...
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
  });
  // 收完一条消息，顺手拍一次变量快照（看这轮更新后的状态）
  snapshotVariables('收到消息后');
});

// -- 3. 滑动/切换回复 --
safeOn('message_swiped', (message_id) => {
  sendToPhonebooth({ kind: 'event', event: '滑动回复', message_id });
});

// -- 4. 消息被修改 --
safeOn('message_updated', (message_id) => {
  sendToPhonebooth({ kind: 'event', event: '消息被修改', message_id });
});

// -- 5. 消息被删除 --
safeOn('message_deleted', (message_id) => {
  sendToPhonebooth({ kind: 'event', event: '消息被删除', message_id });
});

// -- 6. 切换聊天 --
safeOn('chat_changed', (chat_id) => {
  sendToPhonebooth({ kind: 'event', event: '切换聊天', chat_id });
  snapshotVariables('切换聊天后');
});

// -- 7. 生成开始 --
safeOn('generation_started', (type, option, dry_run) => {
  sendToPhonebooth({
    kind: 'event',
    event: 'AI生成开始',
    type,
    dry_run,
    chat_id: getCurrentContext().chat_id,
  });
});

// -- 8. 生成结束 --
safeOn('generation_ended', (message_id) => {
  sendToPhonebooth({ kind: 'event', event: 'AI生成结束', message_id });
});

// -- 9. 生成被中止 --
safeOn('generation_stopped', () => {
  sendToPhonebooth({ kind: 'event', event: 'AI生成被中止' });
});

// -- 10. 提示词拼装完成 —— 这是最核心的观测点 --
//     酒馆在把提示词发给 AI 之前会广播它，我们顺手抄一份全文。
//     注意：文本补全（text completion）模式下在这里拿字符串提示词；
//     OpenAI 兼容（chat completion）模式下真正的提示词在
//     chat_completion_prompt_ready 事件里（消息数组），见下一段。
safeOn('generate_after_combine_prompts', (result) => {
  const promptText = result && result.prompt ? result.prompt : '';
  if (!promptText) return;   // chat completion 模式下这里是空的，交给下面那个事件
  const dryRun = result && result.dryRun;
  const promptId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'prompt',
    prompt_id: promptId,
    prompt: promptText,
    dry_run: dryRun,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
  });
});

// -- 10b. OpenAI 兼容（chat completion）模式的最终提示词 --
//     酒馆把拼好的消息数组（角色/内容列表）通过这个事件广播，
//     我们把它拼成可读文本存档。
safeOn('chat_completion_prompt_ready', (result) => {
  const chat = result && Array.isArray(result.chat) ? result.chat : [];
  if (!chat.length) return;
  const dryRun = result && result.dryRun;
  // 拼成“角色: 内容”的可读文本，方便直接阅读
  const parts = chat.map((m) => {
    const role = m && m.role ? m.role : '?';
    const content = m && typeof m.content === 'string' ? m.content : '';
    return `【${role}】${content}`;
  });
  const promptText = parts.join('\n');
  const promptId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'prompt',
    prompt_id: promptId,
    prompt: promptText,
    dry_run: dryRun,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
  });
});

// -- 11. 世界书被点亮（条目被激活进上下文）--
safeOn('world_info_activated', (entries) => {
  const list = (entries || []).map((e) => ({
    // 世界书条目在酒馆里的"显示名"字段是 comment（备注），部分版本也有 title
    name: e.comment || e.title || e.display_name || e.uid || '?',
    enabled: e.enabled !== false,
    keys: Array.isArray(e.keys) ? e.keys.slice(0, 5) : [],
  }));
  sendToPhonebooth({
    kind: 'worldbook',
    chat_id: getCurrentContext().chat_id,
    entries: list,
  });
});

// ====================== 捕获报错 ======================

// -- 12. 脚本运行时的未捕获错误（前端报错盲区）--
window.addEventListener('error', (e) => {
  sendToPhonebooth({
    kind: 'error',
    message: e.message || String(e.error || '未知错误'),
    source: e.filename || '?',
    line: e.lineno,
  });
});

// -- 13. 未处理的 Promise 拒绝 --
window.addEventListener('unhandledrejection', (e) => {
  sendToPhonebooth({
    kind: 'error',
    message: '未处理的Promise拒绝: ' + (e.reason ? String(e.reason) : '未知'),
  });
});

// ====================== 定期自动快照 ======================
// 每隔 SNAPSHOT_INTERVAL 秒拍一张状态快照，防止"没触发事件但状态悄悄变了"的漏网
setInterval(() => {
  snapshotVariables('定时快照');
}, SNAPSHOT_INTERVAL * 1000);

// ====================== 启动确认 ======================
sendToPhonebooth({
  kind: 'event',
  event: '观测脚本已启动（摄像头开始工作）',
  chat_id: getCurrentContext().chat_id,
  char_name: getCurrentContext().char_name,
});
console.info('[观测台] 观测脚本已启动，正在旁观酒馆……');
