"""去掉探查记录里的凭证：cookie、Authorization、各种 token / session / nonce 等。

原则：宁可多删，不可漏删。请求头和响应头只保留白名单里的几项，其余只留名字、值替换成 [已移除]。
"""

from __future__ import annotations

import json
import re
from urllib.parse import parse_qsl, quote_plus, urlparse, urlunparse

REMOVED = "[已移除]"

SENSITIVE_KEY_RE = re.compile(
    r"(token|password|passwd|pwd|secret|session|sess|cookie|auth|csrf|xsrf|nonce|saml|ticket|"
    r"signature|^sig$|jwt|credential|apikey|api_key|api-key|private|otp|mfa|"
    r"assertion|bearer|^key$|_key$|-key$|sid$|relaystate)",
    re.I,
)
# 网址参数里额外移除 OAuth 常见的 code / state
QUERY_EXTRA_RE = re.compile(r"^(code|state|id_token|access_token|refresh_token)$", re.I)

# 请求头 / 响应头里可以原样保留的项
SAFE_HEADERS = {
    "accept",
    "accept-language",
    "content-type",
    "content-length",
    "cache-control",
    "x-requested-with",
    "user-agent",
    "referer",
    "origin",
    "location",
    "content-language",
}

JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*")
# 长串的随机字符（很可能是令牌），不含空格
LONG_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{48,}={0,2}(?![A-Za-z0-9+/=_-])")
_INLINE_SECRET_RE = re.compile(
    r"""(["']?[\w.-]*(?:token|nonce|csrf|xsrf|session|secret|password|auth)[\w.-]*["']?\s*[:=]\s*)(["'])(.*?)(\2)""",
    re.I,
)


def is_sensitive_key(name: str, in_query: bool = False) -> bool:
    name = str(name)
    return bool(SENSITIVE_KEY_RE.search(name) or (in_query and QUERY_EXTRA_RE.search(name)))


def scrub_text(s: str) -> str:
    s = JWT_RE.sub(REMOVED, s)
    s = LONG_TOKEN_RE.sub(REMOVED, s)
    return s


def sanitize_url(url: str) -> str:
    if not url:
        return url
    try:
        p = urlparse(url)
    except ValueError:
        return REMOVED
    netloc = p.netloc
    if "@" in netloc:  # 用户名:密码@主机
        netloc = REMOVED + "@" + netloc.split("@", 1)[1]
    query = _sanitize_qs(p.query)
    fragment = p.fragment
    if "=" in fragment or JWT_RE.search(fragment):
        fragment = _sanitize_qs(fragment.lstrip("/?"))
    path = scrub_text(p.path)
    return urlunparse((p.scheme, netloc, path, p.params, query, fragment))


def _sanitize_qs(q: str) -> str:
    if not q:
        return q
    pairs = parse_qsl(q, keep_blank_values=True)
    out = []
    for k, v in pairs:
        if is_sensitive_key(k, in_query=True):
            out.append((k, REMOVED))
        elif v.startswith("http://") or v.startswith("https://"):
            out.append((k, sanitize_url(v)))
        else:
            out.append((k, scrub_text(v)))
    # 手工拼接，让“[已移除]”保持可读，不被转成 %E5%B7%B2...
    return "&".join(
        quote_plus(k, safe="/:[]") + "=" + (v if v == REMOVED else quote_plus(v, safe="/:[]")) for k, v in out
    )


def sanitize_headers(headers: dict[str, str]) -> dict[str, str]:
    out = {}
    for k, v in sorted(headers.items()):
        lk = k.lower()
        if lk in SAFE_HEADERS:
            if lk in ("referer", "location", "origin"):
                out[k] = sanitize_url(v)
            else:
                out[k] = v
        else:
            out[k] = REMOVED
    return out


def sanitize_json(obj, depth: int = 0):
    if depth > 60:
        return REMOVED
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if is_sensitive_key(k) and not isinstance(v, (dict, list)):
                out[k] = REMOVED if v not in (None, "", False) else v
            elif is_sensitive_key(k):
                out[k] = REMOVED
            else:
                out[k] = sanitize_json(v, depth + 1)
        return out
    if isinstance(obj, list):
        return [sanitize_json(v, depth + 1) for v in obj]
    if isinstance(obj, str):
        if obj.startswith("http://") or obj.startswith("https://"):
            return sanitize_url(obj)
        return scrub_text(obj)
    return obj


def sanitize_body_text(text: str, content_type: str = "") -> str:
    """请求体（POST 数据）：能解析成 JSON 或表单就按字段清洗，否则整段移除。"""
    if not text:
        return ""
    t = text.strip()
    if t.startswith("{") or t.startswith("["):
        try:
            return json.dumps(sanitize_json(json.loads(t)), ensure_ascii=False)
        except ValueError:
            pass
    if "=" in t and " " not in t and "form" in (content_type or "form").lower():
        return _sanitize_qs(t)
    return REMOVED


def sanitize_html(html: str) -> str:
    """网页快照：隐藏输入框的值、meta 里的 csrf、脚本里像 token 的值全部移除。"""

    def _input(m: re.Match) -> str:
        tag = m.group(0)
        if re.search(r'type\s*=\s*["\']?(hidden|password)', tag, re.I) or re.search(
            r'name\s*=\s*["\'][^"\']*(token|nonce|csrf|xsrf|session|saml|state|code)[^"\']*["\']', tag, re.I
        ):
            tag = re.sub(r'value\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', f'value="{REMOVED}"', tag, flags=re.I)
        return tag

    html = re.sub(r"<input\b[^>]*>", _input, html, flags=re.I)

    def _meta(m: re.Match) -> str:
        tag = m.group(0)
        if re.search(r"(csrf|xsrf|token|nonce)", tag, re.I):
            tag = re.sub(r'content\s*=\s*("[^"]*"|\'[^\']*\')', f'content="{REMOVED}"', tag, flags=re.I)
        return tag

    html = re.sub(r"<meta\b[^>]*>", _meta, html, flags=re.I)
    html = re.sub(r'\bnonce\s*=\s*("[^"]*"|\'[^\']*\')', f'nonce="{REMOVED}"', html, flags=re.I)
    html = _INLINE_SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + REMOVED + m.group(4), html)
    html = scrub_text(html)
    return html


def json_shape(obj, depth: int = 0, max_list: int = 2):
    """把 JSON 变成“结构说明”：保留字段名和类型，示例值截短，列表只看前几项。"""
    if depth > 12:
        return "…"
    if isinstance(obj, dict):
        return {k: json_shape(v, depth + 1, max_list) for k, v in list(obj.items())[:80]}
    if isinstance(obj, list):
        if not obj:
            return []
        shaped = [json_shape(v, depth + 1, max_list) for v in obj[:max_list]]
        if len(obj) > max_list:
            shaped.append(f"…（共 {len(obj)} 项）")
        return shaped
    if isinstance(obj, str):
        return obj if len(obj) <= 60 else obj[:57] + "…"
    return obj
