// Mask secrets in step output before it reaches anything COMMITTED — the perf
// trace's notes, run.json, report.md and repair packets. The full logs under
// logs/pipeline/ are gitignored and keep the raw text; that is where to look
// when a masked value matters.
//
// Pattern-based and therefore best-effort: it covers the shapes this repo's
// steps print (connection strings, Google/Anthropic keys, bearer tokens,
// presigned-URL signatures). A new secret shape needs a rule here.

/** Key names whose value is a secret wherever they appear as key=value or
 *  a JSON member. */
const SECRET_KEY =
  "password|passwd|pwd|secret|token|access_token|apikey|api_key|private_key";

const RULES: readonly [RegExp, string][] = [
  // scheme://user:password@host — keep user and host, drop the password. The
  // password may contain `/`, `:` or even `@`: it runs to the LAST `@` that
  // is followed by a host.
  [
    /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+):[^\s]*@(?=[A-Za-z0-9.\-[\]]+(?:[:/?#\s"'),]|$))/gi,
    "$1:***@",
  ],
  // .pgpass lines: host:port:database:user:password.
  [/^((?:[^:\s]+):(?:\d+|\*):(?:[^:\s]+):(?:[^:\s]+)):\S+$/gm, "$1:***"],
  // Google API keys and OAuth access tokens.
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza***"],
  [/\bya29\.[0-9A-Za-z_.-]+/g, "ya29.***"],
  // GitHub tokens (classic and fine-grained).
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh_***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***"],
  // Anthropic / OpenAI-style secret keys.
  [/\bsk-(?:ant-)?[0-9A-Za-z_-]{16,}/g, "sk-***"],
  // Authorization headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, "$1 ***"],
  // Presigned URL signatures and tokens in query strings.
  [
    /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Goog-Signature|X-Goog-Credential|Signature|sig|token|access_token|api_key|apikey|key)=)[^&\s"']+/gi,
    "$1***",
  ],
  // JSON members: "password": "…".
  [
    new RegExp(`("(?:${SECRET_KEY})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi"),
    '$1"***"',
  ],
  // KEY=value assignments of anything that names itself a secret.
  [
    /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g,
    "$1=***",
  ],
  // libpq / lower-case key=value: `password=…`, `api_key = '…'`.
  [
    new RegExp(
      `\\b(${SECRET_KEY})\\s*=\\s*(?:"[^"]*"|'(?:[^'\\\\]|\\\\.)*'|(?!\\*\\*\\*)[^\\s&"',;]+)`,
      "gi",
    ),
    "$1=***",
  ],
];

export const redact = (text: string): string =>
  RULES.reduce((s, [re, sub]) => s.replace(re, sub), text);
