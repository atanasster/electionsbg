// Text from a PowerPoint report (.ppt / .pptx). Older Alpha Research posts —
// the 2010 monthly „Обществени нагласи" series — carry their only figures in
// a legacy .ppt, which neither pdftotext nor textutil reads. The file is
// converted to PDF and then read by the same pdftotext path as every other
// report, so a presentation's text is acquired exactly like a PDF's.
//
// Converter, in order: LibreOffice (`soffice --headless`, headless and
// cross-platform) when installed, else Keynote via osascript on macOS. Keynote
// is a GUI app driving one document at a time, so conversions are serialised.
// A failed conversion throws; acquireText turns that into "" for that one
// attachment, the same per-file isolation every other attachment gets.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { extractPdfText } from "../../council/lib/pdf_text";

const run = promisify(execFile);
const CONVERT_TIMEOUT_MS = 180_000;

export const PRESENTATION_RE = /\.pptx?$/i;

/** The AppleScript that opens `argv[1]` in Keynote and exports `argv[2]` as
 *  PDF. Paths travel as argv, never interpolated, so names with quotes,
 *  parentheses or Cyrillic need no escaping. */
export const KEYNOTE_EXPORT_SCRIPT = [
  "on run argv",
  // Resolve the files OUTSIDE the tell block — inside it Keynote, not
  // AppleScript, coerces `POSIX file`, and `open` then returns missing value.
  "set inFile to POSIX file (item 1 of argv)",
  "set outFile to POSIX file (item 2 of argv)",
  'tell application "Keynote"',
  "set d to open inFile",
  "export d to outFile as PDF",
  "close d saving no",
  "end tell",
  "end run",
];

export const keynoteArgs = (input: string, output: string): string[] => [
  ...KEYNOTE_EXPORT_SCRIPT.flatMap((line) => ["-e", line]),
  input,
  output,
];

const hasBinary = async (cmd: string): Promise<boolean> => {
  try {
    await run("which", [cmd]);
    return true;
  } catch {
    return false;
  }
};

const convertToPdf = async (input: string, outDir: string): Promise<string> => {
  // soffice names its output after the input; the Keynote script is told to.
  const output = path.join(
    outDir,
    `${path.basename(input).replace(PRESENTATION_RE, "")}.pdf`,
  );
  if (await hasBinary("soffice")) {
    await run(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", outDir, input],
      { timeout: CONVERT_TIMEOUT_MS },
    );
  } else if (process.platform === "darwin") {
    await run("osascript", keynoteArgs(input, output), {
      timeout: CONVERT_TIMEOUT_MS,
    });
  } else {
    throw new Error("no presentation converter: install LibreOffice (soffice)");
  }
  if (!fs.existsSync(output))
    throw new Error(`presentation conversion produced no PDF for ${input}`);
  return output;
};

let queue: Promise<unknown> = Promise.resolve();

/** Convert in a scratch directory, hand the PDF to `use`, then clean up —
 *  serialised, since Keynote drives one document at a time. */
const withPdf = <T>(
  file: string,
  use: (pdf: string) => Promise<T>,
): Promise<T> => {
  const job = queue.then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polls-ppt-"));
    try {
      return await use(await convertToPdf(path.resolve(file), dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  queue = job.catch(() => undefined);
  return job;
};

/** Plain text of a presentation, via PDF conversion. Throws on failure. */
export const extractPresentationText = (file: string): Promise<string> =>
  withPdf(file, async (pdf) => extractPdfText(fs.readFileSync(pdf)));

/** Write a PDF rendering of a presentation to `outPdf` — for the
 *  independent reader (ai-reading.md), which cannot open a .ppt itself. */
export const convertPresentationToPdf = (
  file: string,
  outPdf: string,
): Promise<void> =>
  withPdf(file, async (pdf) => {
    fs.mkdirSync(path.dirname(path.resolve(outPdf)), { recursive: true });
    fs.copyFileSync(pdf, outPdf);
  });

//   npm run polls:ppt-pdf -- <input.ppt|.pptx> <output.pdf>
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || !PRESENTATION_RE.test(input)) {
    console.error("usage: polls:ppt-pdf -- <input.ppt|.pptx> <output.pdf>");
    process.exitCode = 1;
  } else
    convertPresentationToPdf(input, output).then(
      () => console.log(`wrote ${output}`),
      (e) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      },
    );
}
