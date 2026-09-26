# -*- coding: utf-8 -*-
"""
电话亭 v2 (Phonebooth) — 「酒馆观测台」本地接收端
=====================================================
重构目标：按角色卡分目录/分文件落盘，解决：
- 单文件混写 → 按卡分 observe_卡名.log (JSONL)
- 提示词快照按卡分目录 prompts/卡名/YYYY-MM-DD_HH-mm-ss_seq.txt
- 变量快照完整写入（不截断、合法 JSON、去重心跳）
- 世界书点亮发完整 entry（含 keys 等）
- 全链路 UTF-8、并发安全、无双重转义
"""

import http.server
import json
import os
import sys
import threading
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# ---------- 配置 ----------
HOST = "127.0.0.1"
PORT = 6701
BASE_DIR = Path(__file__).parent.resolve()
LOG_DIR = BASE_DIR / "logs"
PROMPTS_DIR = LOG_DIR / "prompts"
SCHEMA_VERSION = "st-observer/v2"
# --------------------------

LOG_DIR.mkdir(parents=True, exist_ok=True)
PROMPTS_DIR.mkdir(parents=True, exist_ok=True)

# 卡名级锁：防止同一卡多线程写入时行交错
_CARD_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_LOCK = threading.Lock()


def _card_lock(card: str) -> threading.Lock:
    with _LOCKS_LOCK:
        if card not in _CARD_LOCKS:
            _CARD_LOCKS[card] = threading.Lock()
        return _CARD_LOCKS[card]


def _sanitize_card_name(name: str) -> str:
    """文件名安全化：仅替换路径分隔符，保留中文/数字/符号"""
    return name.replace("/", "_").replace("\\", "_")


def _extract_card_name(chat_id: str) -> str:
    """
    从 chat_id 解析卡名。
    格式示例：'鬼作物语V12 - 2026-09-26@16h44m57s604ms'
    取最后一个 ' - ' 之前的部分；无分隔符则全量作为卡名。
    """
    if not chat_id:
        return "UnknownCard"
    # 从右侧找最后一个 ' - '
    idx = chat_id.rfind(" - ")
    if idx != -1:
        return chat_id[:idx].strip()
    return chat_id.strip()


def _now_iso() -> str:
    """ISO 时间戳，含毫秒：2026-09-27T14:30:12.123"""
    return datetime.now().isoformat(timespec="milliseconds")


def _now_file_ts() -> str:
    """文件名用时间戳：2026-09-27_14-30-12"""
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def _append_jsonl(card: str, obj: dict):
    """按卡追加一行 JSONL，自动加锁、建目录"""
    safe = _sanitize_card_name(card)
    path = LOG_DIR / f"observe_{safe}.log"
    lock = _card_lock(safe)
    with lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        # 补全 schema 版本字段
        obj.setdefault("_schema", SCHEMA_VERSION)
        obj.setdefault("_ts", int(datetime.now().timestamp() * 1000))
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _save_prompt_snapshot(card: str, content: str) -> str:
    """存提示词快照到 prompts/卡名/，返回文件名"""
    safe = _sanitize_card_name(card)
    dir = PROMPTS_DIR / safe
    dir.mkdir(parents=True, exist_ok=True)
    ts = _now_file_ts()
    # 序号：同一秒内的第几条
    seq = len(list(dir.glob(f"{ts}_*.txt"))) + 1
    fname = f"{ts}_{seq:03d}.txt"
    (dir / fname).write_text(content, encoding="utf-8")
    return fname


class IngestHandler(http.server.BaseHTTPRequestHandler):
    server_version = "Phonebooth/2.0"

    def log_message(self, fmt, *args):
        pass  # 我们有自己的录像带

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        if urlparse(self.path).path != "/ingest":
            self.send_response(404)
            self.end_headers()
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            event = json.loads(raw)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return
        except Exception:
            self.send_response(500)
            self.end_headers()
            return

        # 规范化：统一用 kind 区分，兼容旧 observer 发来的 event 字段
        kind = event.get("kind") or event.get("event") or "event"
        chat_id = event.get("chat_id", "")
        card = _extract_card_name(chat_id)

        # 统一补全基础字段
        event.setdefault("_schema", SCHEMA_VERSION)
        event.setdefault("_ts", int(datetime.now().timestamp() * 1000))
        event.setdefault("chat_id", chat_id)

        # 分类落盘
        if kind in ("prompt_snapshot", "prompt"):
            content = event.get("content") or event.get("prompt", "")
            fname = _save_prompt_snapshot(card, content)
            # 在观测日志里记一条引用索引
            _append_jsonl(card, {
                "kind": "prompt_snapshot_ref",
                "chat_id": chat_id,
                "file": fname,
                "timestamp": event["_ts"]
            })
        else:
            # 统一写入该卡的 observe_卡名.log (JSONL)
            _append_jsonl(card, event)

        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            # 列出当前已有的卡
            cards = sorted({p.stem.replace("observe_", "") for p in LOG_DIR.glob("observe_*.log")})
            body = json.dumps({"status": "ok", "cards": cards, "schema": SCHEMA_VERSION}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        elif parsed.path == "/":
            # 简单首页
            cards = sorted({p.stem.replace("observe_", "") for p in LOG_DIR.glob("observe_*.log")})
            html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phonebooth</title></head><body>
<h1>📞 电话亭 v2 运行中</h1>
<p>Schema: {SCHEMA_VERSION}</p>
<p>端口: {HOST}:{PORT}</p>
<p>已记录卡: {", ".join(cards) if cards else "暂无"}</p>
<p><a href="/health">/health</a></p>
</body></html>""".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._cors()
            self.end_headers()
            self.wfile.write(html)
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    from http.server import ThreadingHTTPServer

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    try:
        server = Server((HOST, PORT), IngestHandler)
    except OSError as e:
        print(f"[电话亭] 启动失败，端口 {PORT} 可能被占用：{e}", file=sys.stderr)
        sys.exit(1)

    print("=" * 56)
    print("  电话亭 v2 已开启")
    print(f"  端口：{HOST}:{PORT}")
    print(f"  录像带目录：{LOG_DIR}")
    print(f"  提示词目录：{PROMPTS_DIR}")
    print(f"  Schema：{SCHEMA_VERSION}")
    print("  按卡分文件：observe_卡名.log (JSONL)")
    print("  提示词：prompts/卡名/YYYY-MM-DD_HH-mm-ss_001.txt")
    print("  按 Ctrl+C 停止。")
    print("=" * 56)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[电话亭] 已停止。")
        server.server_close()