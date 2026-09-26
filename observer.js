/**
 * ============================================================
 *  酒馆观测台 v2 · 观测脚本（摄像头）
 *  ============================================================
 *  Schema: st-observer/v2
 *  变更：按卡分日志、变量快照变化驱动、字段全量、世界书完整 entry
 *  把这个脚本粘贴进 酒馆助手 → 脚本库 → 全局脚本库 里保存，
 *  它就会开始"只看不动"地记录酒馆里发生的事。
 *
 *  它做什么：
 *    - 监听酒馆的内部广播：消息收发、生成开始/结束/中止、
 *      提示词全文、世界书点亮、变量变化、报错
 *    - 把每条观测记录通过 HTTP 发给本地的"电话亭"
 *      （phonebooth.py v2，监听 127.0.0.1:6701）
 *    - 电话亭按 chat_id 解析卡名，分文件落盘
 *
 *  它不做什么：
 *    - 不发消息、不改数据、不调用 AI、不连外网
 *    - 纯粹旁观，零额外算力
 *
 *  使用前提：电话亭正在运行（先双击启动 phonebooth.py 窗口）
 * ============================================================
 */

// ====================== 配置区 ======================
const PHONEBOOTH_URL = 'http://127.0.0.1:6701/ingest';
const SCHEMA_VERSION = 'st-observer/v2';
// 仅对 character + global 做深比较（chat 层变化太频繁，不做去重键）
// ==============================================================

// ---------- 小工具：统一发送（自动补 _schema/_ts） ----------
async function sendToPhonebooth(payload) {
  try {
    const obj = {
      ...payload,
      _schema: SCHEMA_VERSION,
      _ts: Date.now(),
    };
    await fetch(PHONEBOOTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
  } catch (err) {
    // 电话亭没开时静默失败，不打扰酒馆
    console.info('[观测台] 电话亭未连接（忽略）：', err.message);
  }
}

// ---------- 小工具：拿酒馆完整上下文（含 eventSource） ----------
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
  const charName = ctx.characters?.[0]?.name
    || (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]?.name)
    || '?';
  return { chat_id: chatId, char_name: charName };
}

// ---------- 小工具：注册事件监听（直连主页总线优先） ----------
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

// ---------- 深度相等（仅用于 character + global 层） ----------
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!keysB.includes(k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true
}

// ---------- 变量快照：变化驱动 ----------
let _lastCharacterVars = null;
let _lastGlobalVars = null;

function _emitVarsIfChanged(reason) {
  const ctx = getCurrentContext();
  const chatId = ctx.chat_id;
  const charName = ctx.char_name;

  // 拉取四层变量
  let chatVars = {}, messageVars = {}, characterVars = {}, globalVars = {};
  try { chatVars = getVariables({ type: 'chat' }); } catch {}
  try { messageVars = getVariables({ type: 'message' }); } catch {}
  try { characterVars = getVariables({ type: 'character' }); } catch {}
  try { globalVars = getVariables({ type: 'global' }); } catch {}

  // 仅 character + global 做去重
  const charChanged = !deepEqual(characterVars, _lastCharacterVars);
  const globChanged = !deepEqual(globalVars, _lastGlobalVars);
  if (!charChanged && !globChanged) {
    // 两层都没变，不发（避免空转心跳）
    return;
  }
  _lastCharacterVars = JSON.parse(JSON.stringify(characterVars));
  _lastGlobalVars = JSON.parse(JSON.stringify(globalVars));

  // 完整对象发送（不截断）
  sendToPhonebooth({
    kind: 'variable_snapshot',
    chat_id: chatId,
    char_name: charName,
    variables: { chat: chatVars, message: messageVars, character: characterVars, global: globalVars },
    reason,
  });
}

// 在关键业务节点调用 _emitVarsIfChanged
function triggerVarsSnapshot(reason) {
  _emitVarsIfChanged(reason);
}

// ====================== 监听酒馆广播 ======================

// 通用事件发送器：自动补 chat_id/char_name
function emitEvent(event, extra = {}) {
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'event',
    event,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
    ...extra,
  });
}

// -- 1. 你发了消息 --
safeOn('message_sent', (message_id) => {
  emitEvent('你发送了消息', { message_id });
});

// -- 2. AI 回了消息 --
safeOn('message_received', (message_id, type) => {
  emitEvent('收到AI消息', { message_id, type });
  triggerVarsSnapshot('收到消息后');
});

// -- 3. 滑动/切换回复 --
safeOn('message_swiped', (message_id) => {
  emitEvent('滑动回复', { message_id });
});

// -- 4. 消息被修改 --
safeOn('message_updated', (message_id) => {
  emitEvent('消息被修改', { message_id });
});

// -- 5. 消息被删除 --
safeOn('message_deleted', (message_id) => {
  emitEvent('消息被删除', { message_id });
});

// -- 6. 切换聊天 --
safeOn('chat_changed', (chat_id) => {
  emitEvent('切换聊天', { chat_id });
  triggerVarsSnapshot('切换聊天后');
});

// -- 7. 生成开始 --
safeOn('generation_started', (type, option, dry_run) => {
  emitEvent('AI生成开始', { type, dry_run: !!dry_run });
});

// -- 8. 生成结束（补全 chat_id/char_name/type/dry_run） --
safeOn('generation_ended', (message_id, type, dry_run) => {
  emitEvent('AI生成结束', { message_id, type, dry_run: !!dry_run });
  triggerVarsSnapshot('生成结束后');
});

// -- 9. 生成被中止 --
safeOn('generation_stopped', (message_id) => {
  emitEvent('AI生成被中止', { message_id });
});

// -- 10. 提示词拼装完成（text completion 模式）--
safeOn('generate_after_combine_prompts', (result) => {
  const promptText = result && result.prompt ? result.prompt : '';
  if (!promptText) return; // chat completion 模式下空，交给下面事件
  const dryRun = result && result.dryRun;
  const promptId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'prompt_snapshot',
    prompt_id: promptId,
    content: promptText,
    dry_run: !!dryRun,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
  });
});

// -- 10b. OpenAI 兼容（chat completion）模式的最终提示词 --
safeOn('chat_completion_prompt_ready', (result) => {
  const chat = result && Array.isArray(result.chat) ? result.chat : [];
  if (!chat.length) return;
  const dryRun = result && result.dryRun;
  const parts = chat.map((m) => {
    const role = m && m.role ? m.role : '?';
    const content = m && typeof m.content === 'string' ? m.content : '';
    return `【${role}】${content}`;
  });
  const promptText = parts.join('\n');
  const promptId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ctx = getCurrentContext();
  sendToPhonebooth({
    kind: 'prompt_snapshot',
    prompt_id: promptId,
    content: promptText,
    dry_run: !!dryRun,
    chat_id: ctx.chat_id,
    char_name: ctx.char_name,
  });
});

// -- 11. 世界书被点亮（完整 entry）--
safeOn('world_info_activated', (entries) => {
  const list = (entries || []).map((e) => ({
    name: e.comment || e.title || e.display_name || e.uid || '?',
    comment: e.comment,
    keys: Array.isArray(e.keys) ? e.keys : [],
    enabled: e.enabled !== false,
    order: e.order ?? e.insertion_order ?? 0,
    priority: e.priority ?? 0,
    id: e.id,
  }));
  sendToPhonebooth({
    kind: 'worldbook_lit',
    chat_id: getCurrentContext().chat_id,
    entries: list,
  });
});

// -- 12. 变量更新事件（酒馆助手暴露的变量变化事件）--
// 监听这个事件，实现变量变化驱动快照
safeOn('variable_updated', (info) => {
  // info 可能包含 { type, key, value } 或类似结构
  // 无论什么触发，直接检查并发送变化
  triggerVarsSnapshot('变量更新');
});

// 兼容旧事件名
safeOn('variable_changed', (info) => {
  triggerVarsSnapshot('变量更新');
});

// ====================== 捕获报错 ======================

window.addEventListener('error', (e) => {
  sendToPhonebooth({
    kind: 'error',
    message: e.message || String(e.error || '未知错误'),
    source: e.filename || '?',
    line: e.lineno,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  sendToPhonebooth({
    kind: 'error',
    message: '未处理的Promise拒绝: ' + (e.reason ? String(e.reason) : '未知'),
  });
});

// ====================== 启动确认 ======================
sendToPhonebooth({
  kind: 'event',
  event: '观测脚本已启动（摄像头开始工作）',
  chat_id: getCurrentContext().chat_id,
  char_name: getCurrentContext().char_name,
});
console.info('[观测台] 观测脚本 v2 已启动，Schema: ' + SCHEMA_VERSION);