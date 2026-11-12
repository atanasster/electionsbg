// Mask secrets in step output before it reaches anything COMMITTED — the perf
// trace's notes, run.json, report.md and repair packets. The full logs under
// logs/pipeline/ are gitignored and keep the raw text; that is where to look
// when a masked value matters.
//
// Pattern-based and therefore best-effort: it covers the shapes this repo's
// steps print (connection strings, Google/Anthropic keys, bearer tokens,
// presigned-URL signatures). A new secret shape needs a rule here.

const RULES: readonly [RegExp, string][] = [
  // postgres://user:password@host — keep user and host, drop the password.
  [
    /\b((?:postgres(?:ql)?|mysql|redis|amqp):\/\/[^:\s/@]+):[^@\s/]+@/gi,
    "$1:***@",
  ],
  // Google API keys.
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza***"],
  // Anthropic / OpenAI-style secret keys.
  [/\bsk-(?:ant-)?[0-9A-Za-z_-]{16,}/g, "sk-***"],
  // Authorization headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, "$1 ***"],
  // Presigned URL signatures and tokens in query strings.
  [
    /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Goog-Signature|X-Goog-Credential|Signature|sig|token|access_token|api_key|apikey|key)=)[^&\s"']+/gi,
    "$1***",
  ],
  // KEY=value assignments of anything that names itself a secret.
  [
    /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g,
    "$1=***",
  ],
];

export const redact = (text: string): string =>
  RULES.reduce((s, [re, sub]) => s.replace(re, sub), text);
