#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

DEFAULT_ENDPOINT = "http://127.0.0.1:3001/mcp"
DEFAULT_CREDENTIALS_FILE = Path.home() / ".agent_fs" / "credentials.json"
DEFAULT_CONNECTION_FILE = Path.home() / ".agent_fs" / "skill-state.json"
GLOBAL_OPTIONS = {
    "--endpoint",
    "--token",
    "--credentials-file",
    "--connection-file",
    "--timeout",
}


class CliError(RuntimeError):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent FS 知识库 CLI")
    parser.add_argument("--endpoint")
    parser.add_argument("--token")
    parser.add_argument("--credentials-file")
    parser.add_argument("--connection-file")
    parser.add_argument("--timeout", type=float, default=30.0)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health")
    subparsers.add_parser("probe")
    subparsers.add_parser("tools-list")
    subparsers.add_parser("list-indexes")

    connect_cloud = subparsers.add_parser("connect-cloud")
    connect_cloud.add_argument("--email")
    connect_cloud.add_argument("--password")
    connect_cloud.add_argument("--client", default="cli")
    connect_cloud.add_argument("--tenant-name")
    connect_cloud.add_argument("--register-if-needed", action="store_true")

    login_cloud = subparsers.add_parser("login-cloud")
    login_cloud.add_argument("--email", required=True)
    login_cloud.add_argument("--password", required=True)
    login_cloud.add_argument("--client", default="cli")

    register_cloud = subparsers.add_parser("register-cloud")
    register_cloud.add_argument("--email", required=True)
    register_cloud.add_argument("--password", required=True)
    register_cloud.add_argument("--tenant-name")

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
    try:
        args = build_parser().parse_args(normalize_cli_argv(sys.argv[1:]))
        resolve_runtime_args(args)
        result = dispatch(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except CliError as exc:
        print(f"agent-fs-cli: {exc}", file=sys.stderr)
        return 1


def normalize_cli_argv(argv: list[str]) -> list[str]:
    global_args: list[str] = []
    remaining: list[str] = []
    i = 0
    while i < len(argv):
        token = argv[i]
        if token in GLOBAL_OPTIONS:
            global_args.append(token)
            if i + 1 >= len(argv):
                raise CliError(f"缺少 {token} 的参数值")
            global_args.append(argv[i + 1])
            i += 2
            continue
        remaining.append(token)
        i += 1
    return global_args + remaining


def resolve_runtime_args(args: argparse.Namespace) -> None:
    args.connection_file = resolve_connection_file(args.connection_file)
    args.endpoint = resolve_endpoint(args.endpoint, args.connection_file)
    args.credentials_file = resolve_credentials_file(args.credentials_file)
    args.token, args.token_source = resolve_token(
        args.endpoint,
        explicit_token=args.token,
        credentials_file=args.credentials_file,
    )


def resolve_endpoint(raw: str | None, connection_file: Path) -> str:
    raw_endpoint = (
        raw
        or os.getenv("AGENT_FS_ENDPOINT")
        or os.getenv("AGENT_FS_MCP_URL")
        or load_default_endpoint(connection_file)
        or DEFAULT_ENDPOINT
    )
    parsed = urlparse(raw_endpoint)
    if not parsed.scheme or not parsed.netloc:
        raise CliError(f"endpoint 非法: {raw_endpoint}")
    return ensure_service_endpoint(raw_endpoint)


def resolve_credentials_file(raw: str | None) -> Path:
    value = raw or os.getenv("AGENT_FS_CREDENTIALS_FILE")
    return Path(value).expanduser() if value else DEFAULT_CREDENTIALS_FILE


def resolve_connection_file(raw: str | None) -> Path:
    value = raw or os.getenv("AGENT_FS_CONNECTION_FILE")
    return Path(value).expanduser() if value else DEFAULT_CONNECTION_FILE


def resolve_token(
    endpoint: str,
    explicit_token: str | None,
    credentials_file: Path,
) -> tuple[str | None, str]:
    if explicit_token:
        return explicit_token, "argument"

    env_token = os.getenv("AGENT_FS_TOKEN") or os.getenv("AGENT_FS_MCP_TOKEN")
    if env_token:
        return env_token, "env"

    if not credentials_file.exists():
        return None, "none"

    try:
        raw = credentials_file.read_text(encoding="utf-8").strip()
        if not raw:
            return None, "none"
        credentials = json.loads(raw)
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
    base_url = to_base_url(endpoint)
    return [base_url, endpoint]


def dispatch(args: argparse.Namespace):
    if args.command == "health":
        return get_json(to_health_url(args.endpoint), args.token, args.timeout)
    if args.command == "probe":
        return probe_endpoint(args)
    if args.command == "connect-cloud":
        return connect_cloud(args)
    if args.command == "login-cloud":
        return login_cloud(args)
    if args.command == "register-cloud":
        return register_cloud(args)
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
        "target": normalize_target(args.endpoint),
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


def connect_cloud(args: argparse.Namespace) -> dict:
    result = {
        "ok": False,
        "status": "connecting",
        "endpoint": args.endpoint,
        "target": normalize_target(args.endpoint),
        "auth": {
            "has_token": bool(args.token),
            "token_source": args.token_source,
            "credentials_file": str(args.credentials_file),
            "login_performed": False,
            "needs_login": False,
        },
        "quick_test": {
            "health": None,
            "tools_list": None,
            "list_indexes": None,
        },
        "connection": {
            "saved": False,
            "connection_file": str(args.connection_file),
        },
    }

    result["quick_test"]["health"] = get_json(to_health_url(args.endpoint), args.token, args.timeout)
    save_default_endpoint(args.connection_file, args.endpoint)
    result["connection"]["saved"] = True

    try:
        tools_result = fetch_tools(args)
    except CliError as exc:
        if not is_auth_error(exc):
            raise
        result["auth"]["needs_login"] = True
        if not args.email or not args.password:
            result["quick_test"]["tools_list"] = {"ok": False, "error": str(exc)}
            result["status"] = "needs_login"
            result["message"] = "服务已连通，但需要登录后才能调用知识库工具。"
            result["next_action"] = "使用 connect-cloud 补充 email/password 后重试。"
            return result

        try:
            login_result = login_cloud(args)
        except CliError:
            if not args.register_if_needed:
                raise
            register_cloud(args)
            login_result = login_cloud(args)
        result["auth"]["login_performed"] = True
        result["auth"]["needs_login"] = False
        result["auth"]["token_source"] = f"credentials:{args.credentials_file}"
        result["auth"]["has_token"] = True
        result["auth"]["login_result"] = login_result
        args.token = None
        args.token, args.token_source = resolve_token(
            args.endpoint,
            explicit_token=args.token,
            credentials_file=args.credentials_file,
        )
        tools_result = fetch_tools(args)

    result["quick_test"]["tools_list"] = {
        "ok": True,
        "count": len(tools_result.get("tools", [])),
        "names": [tool.get("name") for tool in tools_result.get("tools", [])],
    }

    try:
        list_indexes_result = call_tool(args, "list_indexes", {})
        project_count = len(list_indexes_result) if isinstance(list_indexes_result, list) else None
        result["quick_test"]["list_indexes"] = {
            "ok": True,
            "project_count": project_count,
            "result": list_indexes_result,
        }
    except CliError as exc:
        result["quick_test"]["list_indexes"] = {"ok": False, "error": str(exc)}

    result["ok"] = True
    result["status"] = "connected"
    result["message"] = "云端知识库服务已连接，快速测试已完成。"
    return result


def login_cloud(args: argparse.Namespace) -> dict:
    result = post_json(
        to_api_url(args.endpoint, "/api/auth/login"),
        {
            "email": args.email,
            "password": args.password,
            "client": args.client,
        },
        token=None,
        timeout=args.timeout,
    )
    return persist_auth_result(args, result, email=args.email)


def register_cloud(args: argparse.Namespace) -> dict:
    payload = {
        "email": args.email,
        "password": args.password,
    }
    if args.tenant_name:
        payload["tenantName"] = args.tenant_name
    result = post_json(
        to_api_url(args.endpoint, "/api/auth/register"),
        payload,
        token=None,
        timeout=args.timeout,
    )
    return persist_auth_result(args, result, email=args.email)


def persist_auth_result(args: argparse.Namespace, result: dict, email: str) -> dict:
    access_token = result.get("accessToken")
    refresh_token = result.get("refreshToken")
    if not isinstance(access_token, str) or not isinstance(refresh_token, str):
        raise CliError(f"登录返回格式异常: {json.dumps(result, ensure_ascii=False)}")

    target = normalize_target(args.endpoint)
    expires_at = parse_token_expiry(access_token) or default_cli_expiry()
    store_credential(
        args.credentials_file,
        target,
        {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "expiresAt": expires_at,
            "email": email,
        },
    )
    return {
        "ok": True,
        "target": target,
        "endpoint": args.endpoint,
        "email": email,
        "credentials_file": str(args.credentials_file),
        "expires_at": expires_at,
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


def store_credential(credentials_file: Path, target: str, credential: dict) -> None:
    credentials_file.parent.mkdir(parents=True, exist_ok=True)
    store: dict[str, dict] = {}
    if credentials_file.exists():
        try:
            raw_store = json.loads(credentials_file.read_text(encoding="utf-8"))
            if isinstance(raw_store, dict):
                store = raw_store
        except json.JSONDecodeError:
            store = {}
    store[target] = credential
    credentials_file.write_text(
        json.dumps(store, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    credentials_file.chmod(0o600)


def load_default_endpoint(connection_file: Path) -> str | None:
    if not connection_file.exists():
        return None
    try:
        state = json.loads(connection_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if not isinstance(state, dict):
        return None
    endpoint = state.get("defaultEndpoint")
    return endpoint if isinstance(endpoint, str) and endpoint else None


def save_default_endpoint(connection_file: Path, endpoint: str) -> None:
    connection_file.parent.mkdir(parents=True, exist_ok=True)
    state = {
        "defaultEndpoint": normalize_target(endpoint),
        "savedAt": datetime.now(timezone.utc).isoformat(),
    }
    connection_file.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    connection_file.chmod(0o600)


def normalize_target(endpoint: str) -> str:
    return to_base_url(endpoint)


def to_base_url(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/mcp"):
        base_path = path[:-4]
    elif path.endswith("/health"):
        base_path = path[:-7]
    else:
        base_path = path
    return urlunparse((parsed.scheme, parsed.netloc, base_path, "", "", "")).rstrip("/")


def to_api_url(endpoint: str, api_path: str) -> str:
    base_url = to_base_url(endpoint)
    return f"{base_url}{api_path}"


def parse_token_expiry(access_token: str) -> str | None:
    parts = access_token.split(".")
    if len(parts) < 2:
        return None

    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding)
        data = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    exp = data.get("exp")
    if not isinstance(exp, int):
        return None
    return datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()


def default_cli_expiry() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()


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
    return f"{to_base_url(endpoint)}/health"


def ensure_service_endpoint(raw_endpoint: str) -> str:
    parsed = urlparse(raw_endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/mcp"):
        service_path = path
    elif path.endswith("/health"):
        service_path = f"{path[:-7]}/mcp" or "/mcp"
    elif path in ("", "/"):
        service_path = "/mcp"
    else:
        service_path = f"{path}/mcp"
    return urlunparse((parsed.scheme, parsed.netloc, service_path, "", "", ""))


def is_auth_error(exc: CliError) -> bool:
    message = str(exc)
    return (
        "HTTP 401" in message
        or "Unauthorized" in message
        or "Authorization header" in message
    )


if __name__ == "__main__":
    sys.exit(main())
