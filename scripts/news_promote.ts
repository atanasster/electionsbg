import { execFileSync } from "node:child_process";
import path from "node:path";

type ChannelList = {
  result?: {
    channels?: Array<{
      name?: string;
      release?: { version?: { name?: string } };
    }>;
  };
};

const SITE = "electionsbg-news";
const PROJECT = "news";

export type FirebaseRunner = {
  capture(args: string[]): string;
  inherit(args: string[]): void;
};

const firebaseRunner: FirebaseRunner = {
  capture: (args) =>
    execFileSync("firebase", args, { encoding: "utf8" }),
  inherit: (args) => {
    execFileSync("firebase", args, { stdio: "inherit" });
  },
};

export function liveVersionId(payload: ChannelList): string | null {
  const channel = payload.result?.channels?.find((candidate) =>
    candidate.name?.endsWith("/channels/live"),
  );
  return channel?.release?.version?.name?.split("/").at(-1) ?? null;
}

export function promote(
  expectedVersion: string,
  runner: FirebaseRunner = firebaseRunner,
): void {
  if (!/^[a-z0-9]+$/i.test(expectedVersion))
    throw new Error("NEWS_VERSION_ID must be a Firebase Hosting version id");

  const raw = runner.capture(
    ["hosting:channel:list", "--site", SITE, "-P", PROJECT, "--json"],
  );
  if (liveVersionId(JSON.parse(raw) as ChannelList) === expectedVersion) {
    console.log(`Firebase Hosting version ${expectedVersion} is already live.`);
    return;
  }

  runner.inherit(
    [
      "hosting:clone",
      `${SITE}@${expectedVersion}`,
      `${SITE}:live`,
      "-P",
      PROJECT,
    ],
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const expectedVersion = process.env.NEWS_VERSION_ID;
  if (!expectedVersion)
    throw new Error("NEWS_VERSION_ID is required for production promotion");
  promote(expectedVersion);
}
