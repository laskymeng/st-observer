# -*- coding: utf-8 -*-
"""
电话亭 (Phonebooth) — 「酒馆观测台」的本地接收端
==================================================
它做什么：
    蹲在本机 127.0.0.1:6701，等着接收"观测脚本"从酒馆里传过来的观测记录，
    然后一条条写进日志文件（录像带）。

它不需要任何第三方库，用 Python 自带的东西就能跑：
    python phonebooth.py

它不修改酒馆、不连外网、只看本机，纯旁观。
"""

import http.server
import json
import os
import socket
import sys
import threading
from datetime import datetime

# ---------- 配置 ----------
HOST = "127.0.0.1"          # 只在本机监听，外面进不来
PORT = 6701                 # 端口号（电话号码）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))   # 本项目目录
LOG_DIR = os.path.join(BASE_DIR, "logs")                # 录像带目录
PROMPT_DIR = os.path.join(LOG_DIR, "prompts")           # 提示词全文目录
# --------------------------

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(PROMPT_DIR, exist_ok=True)

# 主日志文件（一行一条事件，追加写）
MAIN_LOG = os.path.join(LOG_DIR, "observe.log")


def now():
    """当前时间，形如 2026-09-24 17:52:03.123"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def write_log_line(line: str):
    """追加一行到录像带主日志。用锁防止多条同时写时串行。"""
    with threading.Lock():
        with open(MAIN_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")


class Handler(http.server.BaseHTTPRequestHandler):
    """处理观测脚本发来的请求：两种——报到 /ingest，健康检查 /health"""

    # ---- 关掉默认的服务器自报日志（我们有自己的录像带）----
    def log_message(self, fmt, *args):
        pass

    # ---- 给所有响应都盖上"允许跨域"的头，观测脚本才能从酒馆页面发过来 ----
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # 浏览器跨域前会先发一个 OPTIONS 探路请求，我们直接放行
    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    # 观测脚本把一条观测记录 POST 到这里
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            data = json.loads(raw)
        except Exception:
            data = {"type": "raw", "payload": raw}

        self._record(data)

        self.send_response(200)
        self._send_cors()
        self.end_headers()
        self.wfile.write(b"ok")

    # 健康检查 / 也顺带确认电话亭活着
    def do_GET(self):
        if self.path.startswith("/health"):
            body = json.dumps({"status": "alive", "log": MAIN_LOG}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors()
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    # ---- 把一条观测记录拆开写进录像带 ----
    def _record(self, data):
        t = now()
        kind = data.get("kind", "event")
        content = data.get("content", "")

        # 提示词全文单独存文件，避免主日志被撑爆
        if kind == "prompt":
            prompt = data.get("prompt", "")
            gen_id = data.get("prompt_id", "unknown")
            fname = os.path.join(PROMPT_DIR, f"{gen_id}.txt")
            try:
                with open(fname, "w", encoding="utf-8") as f:
                    f.write(prompt)
            except Exception as e:
                fname = f"<写入失败:{e}>"
            # 主日志里只记一行指针
            write_log_line(f"[{t}] [提示词快照] {gen_id} → {os.path.basename(fname)}")
            return

        if kind == "error":
            write_log_line(f"[{t}] [报错] {content}")
            return

        if kind == "chat":
            write_log_line(f"[{t}] [消息] {content}")
            return

        if kind == "vars":
            # 变量快照内容不逐字段打印（太长），只记一句话 + 详情落单独文件
            scope = data.get("scope", "?")
            try:
                detail = json.dumps(data.get("variables", {}), ensure_ascii=False)
            except Exception:
                detail = str(data.get("variables", ""))
            write_log_line(f"[{t}] [变量快照:{scope}] {detail[:200]}{'…' if len(detail) > 200 else ''}")
            return

        if kind == "worldbook":
            try:
                detail = json.dumps(data.get("entries", []), ensure_ascii=False)
            except Exception:
                detail = str(data.get("entries", ""))
            write_log_line(f"[{t}] [世界书点亮] {detail[:300]}{'…' if len(detail) > 300 else ''}")
            return

        # 兜底：普通事件
        write_log_line(f"[{t}] [事件] {json.dumps(data, ensure_ascii=False)[:300]}")

if __name__ == "__main__":
    class Server(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    try:
        server = Server((HOST, PORT), Handler)
    except OSError as e:
        print(f"[电话亭] 启动失败，端口 {PORT} 可能被占用：{e}")
        sys.exit(1)

    print("=" * 50)
    print(f"  电话亭已开启")
    print(f"  端口：{HOST}:{PORT}")
    print(f"  录像带目录：{LOG_DIR}")
    print(f"  主日志：{MAIN_LOG}")
    print(f"  把观测脚本装进酒馆后，这里会开始记笔记。")
    print(f"  按 Ctrl+C 或直接关掉这个窗口即可停止。")
    print("=" * 50)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[电话亭] 已停止。")
        server.server_close()