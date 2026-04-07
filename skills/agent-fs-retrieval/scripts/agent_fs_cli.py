#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen


class CliError(RuntimeError):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent FS MCP CLI")
    parser.add_argument("--endpoint", default=os.getenv("AGENT_FS_MCP_URL", "http://127.0.0.1:3001/mcp"))
    parser.add_argument("--token", default=os.getenv("AGENT_FS_MCP_TOKEN"))
    parser.add_argument("--timeout", type=float, default=30.0)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health")
    subparsers.add_parser("tools-list")
    subparsers.add_parser("list-indexes")

    dir_tree = subparsers.add_parser("dir-tree")
    dir_tree.add_argument("--scope", required=True)
    dir_tree.add_argument("--depth", type=int, default=2)

    search = subparsers.add_parser("search")
    search.add_argument("--scope", action="append", required=True)
    search.add_argument("--query", required=True)
    search.add_argument("--keyword")
    search.add_argument("--top-k", type=int, default=10)

    get_chunk = subparsers.add_parser("get-chunk")
    get_chunk.add_argument("--chunk-id", required=True)
    get_chunk.add_argument("--include-neighbors", action="store_true")
    get_chunk.add_argument("--neighbor-count", type=int, default=2)

    memory = subparsers.add_parser("get-project-memory")
    memory.add_argument("--project", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = dispatch(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except CliError as exc:
        print(f"agent-fs-cli: {exc}", file=sys.stderr)
        return 1


def dispatch(args: argparse.Namespace):
    if args.command == "health":
        return get_json(to_health_url(args.endpoint), args.token, args.timeout)
    if args.command == "tools-list":
        init_session(args.endpoint, args.token, args.timeout)
        return rpc(args.endpoint, args.token, args.timeout, "tools/list").get("result", {})
    if args.command == "list-indexes":
        return call_tool(args, "list_indexes", {})
    if args.command == "dir-tree":
        return call_tool(args, "dir_tree", {"scope": args.scope, "depth": args.depth})
    if args.command == "search":
        scope = args.scope[0] if len(args.scope) == 1 else args.scope
        payload = {"query": args.query, "scope": scope, "top_k": args.top_k}
        if args.keyword:
            payload["keyword"] = args.keyword
        return call_tool(args, "search", payload)
    if args.command == "get-chunk":
        return call_tool(
            args,
            "get_chunk",
            {
                "chunk_id": args.chunk_id,
                "include_neighbors": args.include_neighbors,
                "neighbor_count": args.neighbor_count,
            },
        )
    if args.command == "get-project-memory":
        return call_tool(args, "get_project_memory", {"project": args.project})
    raise CliError(f"未知命令: {args.command}")


def call_tool(args: argparse.Namespace, name: str, arguments: dict):
    init_session(args.endpoint, args.token, args.timeout)
    response = rpc(
        args.endpoint,
        args.token,
        args.timeout,
        "tools/call",
        {"name": name, "arguments": arguments},
    )
    if "error" in response:
        raise CliError(json.dumps(response["error"], ensure_ascii=False))
    result = response.get("result", {})
    if result.get("isError"):
        raise CliError(extract_text(result))
    text = extract_text(result)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"text": text}


def init_session(endpoint: str, token: str | None, timeout: float) -> None:
    rpc(
        endpoint,
        token,
        timeout,
        "initialize",
        {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "agent-fs-cli", "version": "1.0.0"},
        },
    )
    rpc(endpoint, token, timeout, "notifications/initialized", notification=True)


def rpc(
    endpoint: str,
    token: str | None,
    timeout: float,
    method: str,
    params: dict | None = None,
    notification: bool = False,
):
    payload = {"jsonrpc": "2.0", "method": method}
    if not notification:
        payload["id"] = 1
    if params is not None:
        payload["params"] = params
    return post_json(endpoint, payload, token, timeout)


def post_json(url: str, payload: dict, token: str | None, timeout: float):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    return open_and_parse(request, timeout)


def get_json(url: str, token: str | None, timeout: float):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return open_and_parse(Request(url, headers=headers, method="GET"), timeout)


def open_and_parse(request: Request, timeout: float):
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return parse_body(body, response.headers.get("Content-Type", ""))
    except HTTPError as exc:
        raise CliError(f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}") from exc
    except URLError as exc:
        raise CliError(f"无法连接服务: {exc.reason}") from exc


def parse_body(body: str, content_type: str):
    if not body:
        return {}
    if "application/json" in content_type:
        return json.loads(body)
    data_lines = [line[5:].strip() for line in body.splitlines() if line.startswith("data:")]
    if not data_lines:
        raise CliError(f"无法解析响应: {body}")
    return json.loads("\n".join(data_lines))


def extract_text(result: dict) -> str:
    content = result.get("content") or []
    for item in content:
        if item.get("type") == "text":
            return item.get("text", "")
    return json.dumps(result, ensure_ascii=False)


def to_health_url(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    return urlunparse((parsed.scheme, parsed.netloc, "/health", "", "", ""))


if __name__ == "__main__":
    sys.exit(main())
