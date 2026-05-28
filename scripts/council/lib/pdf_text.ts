// PDF text extraction via the system pdftotext binary (poppler-utils).
// Chosen over a Node-native PDF library because (1) it's already on every
// dev box we care about, (2) it handles Cyrillic + multi-column layouts
// better than pdf-parse, (3) it adds no npm dep.
//
// If the binary is missing on a host, surface a clear error so the
// operator knows to brew install poppler / apt install poppler-utils.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDFTOTEXT = "pdftotext";

const runPdftotext = (
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn(PDFTOTEXT, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "pdftotext not found on PATH — install poppler-utils (brew install poppler)",
          ),
        );
      } else reject(err);
    });
    child.on("close", (code: number | null) =>
      resolve({ stdout, stderr, code: code ?? 0 }),
    );
  });

/**
 * Extract text from a PDF buffer using pdftotext -layout (preserves columns).
 * Returns the plain UTF-8 text. Throws if the binary is missing or fails.
 */
export const extractPdfText = async (pdfBuffer: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "council-pdf-"));
  const pdfPath = join(dir, "in.pdf");
  const txtPath = join(dir, "out.txt");
  try {
    await writeFile(pdfPath, pdfBuffer);
    const { code, stderr } = await runPdftotext([
      "-layout",
      "-enc",
      "UTF-8",
      pdfPath,
      txtPath,
    ]);
    if (code !== 0) {
      throw new Error(`pdftotext exited ${code}: ${stderr.slice(0, 500)}`);
    }
    return await readFile(txtPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Quick test the PDF has a real text layer (≠ pure image scan). We treat
 * <50 chars of extracted text per page as "probably scanned" and bail —
 * the operator can route that município through the Phase-3 OCR path.
 */
export const looksLikeScannedPdf = (text: string): boolean => {
  const stripped = text.replace(/\s/g, "");
  return stripped.length < 200;
};
