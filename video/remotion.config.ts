import { Config } from "@remotion/cli/config";

/**
 * MUST be set. Remotion otherwise resolves `staticFile()` against the closest
 * `public/` it finds, which in this repo is the SITE's — ~248k files of election
 * JSON, and none of this project's voice-over. The failure is loud for audio (a
 * 404 aborts the render) but SILENT for fonts: a missing face falls back to
 * whatever headless Chromium has, and Cyrillic can come out as tofu boxes with
 * nothing in the logs.
 *
 * Relative to the working directory, i.e. the repo root — all the `video:*`
 * scripts run from there.
 */
Config.setPublicDir("video/public");

// H.264 in an MP4 — what Facebook, Instagram and YouTube all ingest without
// re-encoding surprises.
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setOverwriteOutput(true);

// Renders are verified by extracting frames and reading them (gate 2 of the
// naiasno-video skill), so a wrong-looking frame must be a real defect rather
// than a JPEG artefact.
Config.setJpegQuality(95);

// Chromium's ANGLE backend, conservative concurrency: the render-stability rules
// in .claude/skills/naiasno-video/references/remotion.md. Nothing here uses WebGL
// yet — the maps are d3-geo SVG — but a capture-based walkthrough will, and a
// shimmering basemap is far more expensive to debug than a slower render.
Config.setChromiumOpenGlRenderer("angle");
