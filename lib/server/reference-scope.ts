import mammoth from "mammoth";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type ReferenceScope = {
  sourceType: string;
  workUnits: number;
  detectedColumns: number;
  records: string[][];
  confidence: number;
};

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

function rowsFromText(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("\t")) {
        return line.split("\t").map(normalizeCell);
      }

      return [line];
    });
}


function runCommand(
  command: string,
  args: string[],
  timeoutMs = 30000
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function runOcr(imagePath: string): Promise<string> {
  const configured = process.env.ULTIMA_OCR_LANGS || "eng+hin";
  const languages = /^[a-z0-9_+]+$/.test(configured)
    ? configured
    : "eng+hin";

  try {
    return await runCommand(
      "tesseract",
      [imagePath, "stdout", "-l", languages, "--psm", "6"],
      30000
    );
  } catch {
    if (languages === "eng") return "";
    try {
      return await runCommand(
        "tesseract",
        [imagePath, "stdout", "-l", "eng", "--psm", "6"],
        30000
      );
    } catch {
      return "";
    }
  }
}

async function extractImageOcr(
  buffer: Buffer,
  extension: string
): Promise<string[][]> {
  const supported = new Set([
    "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"
  ]);
  if (!supported.has(extension)) return [];

  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "ultima-ocr-"));
    const imagePath = join(directory, `source.${extension}`);
    await writeFile(imagePath, buffer);
    const text = await runOcr(imagePath);
    return rowsFromText(text);
  } catch {
    return [];
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function extractPdf(buffer: Buffer): Promise<string[][]> {
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  const rows: string[][] = [];
  let directory: string | undefined;
  let pdfPath: string | undefined;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const text = content.items
        .map((item) => {
          if (
            typeof item === "object" &&
            item !== null &&
            "str" in item
          ) {
            return String(
              (item as { str?: unknown }).str ?? ""
            );
          }
          return "";
        })
        .join(" ")
        .trim();

      if (text) {
        rows.push(...rowsFromText(text));
        continue;
      }

      // Bound expensive OCR work on very large scanned PDFs.
      if (pageNumber > 20) continue;

      try {
        if (!directory) {
          directory = await mkdtemp(join(tmpdir(), "ultima-pdf-"));
          pdfPath = join(directory, "source.pdf");
          await writeFile(pdfPath, buffer);
        }

        const prefix = join(directory, `page-${pageNumber}`);
        await runCommand(
          "pdftoppm",
          [
            "-f", String(pageNumber),
            "-l", String(pageNumber),
            "-singlefile",
            "-scale-to", "1600",
            "-png",
            pdfPath!,
            prefix,
          ],
          30000
        );

        const ocrText = await runOcr(`${prefix}.png`);
        if (ocrText.trim()) rows.push(...rowsFromText(ocrText));
      } catch {
        // Keep normal PDF extraction working if local OCR tools are unavailable.
      }
    }
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
    await pdf.cleanup().catch(() => {});
  }

  return rows;
}

async function extractDocx(buffer: Buffer): Promise<string[][]> {
  const result = await mammoth.extractRawText({
    buffer,
  });

  return rowsFromText(result.value);
}

function extractSpreadsheet(
  buffer: Buffer
): string[][] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
  });

  const rows: string[][] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const data = XLSX.utils.sheet_to_json<
      unknown[]
    >(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    for (const row of data) {
      if (!Array.isArray(row)) {
        continue;
      }

      const normalized = row.map(normalizeCell);

      if (
        normalized.some(
          (cell) => cell.length > 0
        )
      ) {
        rows.push(normalized);
      }
    }
  }

  return rows;
}

function extractPlainText(
  buffer: Buffer
): string[][] {
  return rowsFromText(
    buffer.toString("utf8")
  );
}

function getExtension(
  fileName: string
): string {
  const match =
    fileName.toLowerCase().match(/\.([a-z0-9]+)$/);

  return match?.[1] || "";
}

export async function extractReferenceScope(
  buffer: Buffer,
  fileName: string,
  mimeType?: string | null
): Promise<ReferenceScope> {
  const extension = getExtension(fileName);

  let records: string[][] = [];
  let sourceType = "unknown";

  if (
    extension === "pdf" ||
    mimeType === "application/pdf"
  ) {
    sourceType = "pdf";
    records = await extractPdf(buffer);
  } else if (
    extension === "docx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    sourceType = "docx";
    records = await extractDocx(buffer);
  } else if (
    extension === "xlsx" ||
    extension === "xls" ||
    extension === "csv"
  ) {
    sourceType =
      extension === "csv"
        ? "csv"
        : "spreadsheet";

    records = extractSpreadsheet(buffer);
  } else if (
    new Set(["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"]).has(extension) ||
    mimeType?.startsWith("image/")
  ) {
    sourceType = "image";
    records = await extractImageOcr(buffer, extension);
  } else if (
    extension === "txt" ||
    extension === "text" ||
    mimeType?.startsWith("text/")
  ) {
    sourceType = "text";
    records = extractPlainText(buffer);
  }

  const normalizedRecords = records
    .map((row) =>
      row.map(normalizeCell)
    )
    .filter((row) =>
      row.some(
        (cell) => cell.length > 0
      )
    );

  const detectedColumns = Math.max(
    1,
    ...normalizedRecords.map(
      (row) => row.length
    )
  );

  return {
    sourceType,
    workUnits: normalizedRecords.length,
    detectedColumns,
    records: normalizedRecords,
    confidence:
      normalizedRecords.length > 0
        ? 1
        : 0,
  };
}
