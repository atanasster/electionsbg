// Run one command through the home Bulgarian-egress proxy.
//
//   pnpm run bg -- pnpm run kzk:decisions --apply
//
// For the cases the automatic fallback does not reach — chiefly an update-*
// skill running a fetch by hand from abroad. Finds the proxy exactly as the
// pipeline does (scripts/lib/bg_egress.ts) but does NOT apply the
// "already Bulgarian" gate: asking for it explicitly means "use it". Exits
// with the command's own code; refuses (exit 3) when no proxy answers.

import { spawn } from "node:child_process";
import { bgProxyEnv, findBgProxy, proxyLabel } from "./bg_egress";

const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));

const main = async (): Promise<number> => {
  if (!args.length) {
    console.error("usage: pnpm run bg -- <command> [args…]");
    return 2;
  }
  const proxy = await findBgProxy();
  if (!proxy) {
    console.error(
      "bg: no BG proxy answered (tried mac:8118 and Brooks-Mac-mini.local:8118) — is the Mac mini up and on Tailscale? `nc -z mac 8118`",
    );
    return 3;
  }
  console.error(`bg: running through BG proxy ${proxyLabel(proxy)}`);
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      env: { ...process.env, ...bgProxyEnv(proxy) },
      stdio: "inherit",
    });
    child.on("error", (e) => {
      console.error(`bg: ${e.message}`);
      resolve(127);
    });
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
};

main().then((code) => process.exit(code));
