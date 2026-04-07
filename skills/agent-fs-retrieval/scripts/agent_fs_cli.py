#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

DEFAULT_ENDPOINT = "http://127.0.0.1:3001/mcp"
DEFAULT_CREDENTIALS_FILE = Path.home() / ".agent_fs" / "credentials.json"


class CliError(RuntimeError):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent FS MCP CLI")
    parser.add_argument("--endpoint")
    parser.add_argument("--token")
    parser.add_argument("--credentials-file")
    parser.add_argument("--timeout", type=float, default=30.0)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health")
    subparsers.add_parser("probe")
    subparsers.add_parser("tools-list")
    subparsers.add_parser("list-indexes")

    index_documents = subparsers.add_parser("index-documents")
    index_documents.add_argument("--project", required=True)
    index_documents.add_argument("--url", action="append", required=True)

    call_tool = subparsers.add_parser("call-tool")
    call_tool.add_argument("--name", required=True)
    call_tool.add_argument("--arguments-json", default="{}")

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
        resolve_runtime_args(args)
        result = dispatch(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except CliError as exc:
        print(f"agent-fs-cli: {exc}", file=sys.stderr)
        return 1


def resolve_runtime_args(args: argparse.Namespace) -> None:
    args.endpoint = resolve_endpoint(args.endpoint)
    args.credentials_file = resolve_credentials_file(args.credentials_file)
    args.token, args.token_source = resolve_token(
        args.endpoint,
        explicit_token=args.token,
        credentials_file=args.credentials_file,
    )


def resolve_endpoint(raw: str | None) -> str:
    endpoint = raw or os.getenv("AGENT_FS_MCP_URL") or DEFAULT_ENDPOINT
    parsed = urlparse(endpoint)
    if not parsed.scheme or not parsed.netloc:
        raise CliError(f"endpoint 非法: {endpoint}")
    return endpoint


def resolve_credentials_file(raw: str | None) -> Path:
    value = raw or os.getenv("AGENT_FS_CREDENTIALS_FILE")
    return Path(value).expanduser() if value else DEFAULT_CREDENTIALS_FILE


def resolve_token(
    endpoint: str,
    explicit_token: str | None,
    credentials_file: Path,
) -> tuple[str | None, str]:
    if explicit_token:
        return explicit_token, "argument"

    env_token = os.getenv("AGENT_FS_MCP_TOKEN")
    if env_token:
        return env_token, "env"

    if not credentials_file.exists():
        return None, "none"

    try:
        credentials = json.loads(credentials_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CliError(f"凭证文件不是合法 JSON: {credentials_file} ({exc})") from exc

    if not isinstance(credentials, dict):
        raise CliError(f"凭证文件格式错误: {credentials_file}")

    for key in credential_lookup_keys(endpoint):
        item = credentials.get(key)
        if isinstance(item, dict):
            access_token = item.get("accessToken")
            if isinstance(access_token, str) and access_token:
                return access_token, f"credentials:{credentials_file}"

    return None, "none"


def credential_lookup_keys(endpoint: str) -> list[str]:
    parsed = urlparse(endpoint)
    path = parsed.path.rstrip("/")
    base_path = path[:-4] if path.endswith("/mcp") else path
    base_url = urlunparse((parsed.scheme, parsed.netloc, base_path, "", "", ""))
    return [base_url, endpoint]


def dispatch(args: argparse.Namespace):
    if args.command == "health":
        return get_json(to_health_url(args.endpoint), args.token, args.timeout)
    if args.command == "probe":
        return probe_endpoint(args)
    if args.command == "tools-list":
        return fetch_tools(args)
    if args.command == "list-indexes":
        return call_tool(args, "list_indexes", {})
    if args.command == "index-documents":
        return call_tool(args, "index_documents", {"project_id": args.project, "urls": args.url})
    if args.command == "call-tool":
        return call_tool(args, args.name, parse_json_object(args.arguments_json))
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


def probe_endpoint(args: argparse.Namespace) -> dict:
    health_payload = {"ok": False, "error": None, "result": None}
    tools_payload = {"ok": False, "error": None, "result": None}

    try:
        health_payload["result"] = get_json(to_health_url(args.endpoint), args.token, args.timeout)
        health_payload["ok"] = True
    except CliError as exc:
        health_payload["error"] = str(exc)

    try:
        tools_payload["result"] = fetch_tools(args)
        tools_payload["ok"] = True
    except CliError as exc:
        tools_payload["error"] = str(exc)

    tools = tools_payload["result"].get("tools", []) if tools_payload["ok"] else []

    return {
        "ok": health_payload["ok"] and tools_payload["ok"],
        "endpoint": args.endpoint,
        "health_url": to_health_url(args.endpoint),
        "auth": {
            "has_token": bool(args.token),
            "token_source": args.token_source,
            "credentials_file": str(args.credentials_file),
        },
        "health": health_payload,
        "tools": {
            "ok": tools_payload["ok"],
            "error": tools_payload["error"],
            "count": len(tools),
            "names": [tool.get("name") for tool in tools],
        },
        "profile": infer_profile(tools),
    }


def infer_profile(tools: list[dict]) -> dict:
    tool_map = {
        tool.get("name"): tool
        for tool in tools
        if isinstance(tool, dict) and isinstance(tool.get("name"), str)
    }
    dir_tree_scope = read_schema_description(tool_map.get("dir_tree"), "scope")
    project_desc = read_schema_description(tool_map.get("get_project_memory"), "project")
    get_chunk_properties = read_schema_properties(tool_map.get("get_chunk"))

    scope_kind = infer_reference_kind(dir_tree_scope)
    project_kind = infer_reference_kind(project_desc)
    supports_index_documents = "index_documents" in tool_map
    supports_chunk_neighbors = "include_neighbors" in get_chunk_properties

    backend_kind = "unknown"
    if supports_index_documents or scope_kind == "id":
        backend_kind = "cloud"
    elif scope_kind == "path":
        backend_kind = "local"

    return {
        "backend_kind": backend_kind,
        "scope_reference_kind": scope_kind,
        "project_reference_kind": project_kind,
        "supports_index_documents": supports_index_documents,
        "supports_chunk_neighbors": supports_chunk_neighbors,
        "dir_tree_scope_description": dir_tree_scope,
        "project_description": project_desc,
    }


def read_schema_description(tool: dict | None, property_name: str) -> str:
    properties = read_schema_properties(tool)
    target = properties.get(property_name)
    if isinstance(target, dict):
        description = target.get("description")
        if isinstance(description, str):
            return description
    return ""


def read_schema_properties(tool: dict | None) -> dict:
    if not isinstance(tool, dict):
        return {}
    schema = tool.get("inputSchema")
    if not isinstance(schema, dict):
        return {}
    properties = schema.get("properties")
    return properties if isinstance(properties, dict) else {}


def infer_reference_kind(description: str) -> str:
    lowered = description.lower()
    has_path = "路径" in description or "path" in lowered
    has_id = "id" in lowered

    if has_path and has_id:
        return "mixed"
    if has_path:
        return "path"
    if has_id:
        return "id"
    return "unknown"


def parse_json_object(raw: str) -> dict:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CliError(f"--arguments-json 不是合法 JSON: {exc}") from exc

    if not isinstance(value, dict):
        raise CliError("--arguments-json 必须是 JSON object")

    return value


def fetch_tools(args: argparse.Namespace) -> dict:
    init_session(args.endpoint, args.token, args.timeout)
    return rpc(args.endpoint, args.token, args.timeout, "tools/list").get("result", {})


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
    except TimeoutError as exc:
        raise CliError("请求超时，请增大 --timeout 后重试") from exc
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
    path = parsed.path or ""
    if path.endswith("/mcp"):
        health_path = f"{path[:-4]}/health" or "/health"
    elif path in ("", "/"):
        health_path = "/health"
    else:
        health_path = f"{path.rstrip('/')}/health"
    return urlunparse((parsed.scheme, parsed.netloc, health_path, "", "", ""))


if __name__ == "__main__":
    sys.exit(main())
