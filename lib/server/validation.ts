export const VALIDATION_LIMITS = {
  email: 254,
  password: 1024,
  fileName: 180,
  workFileContent: 5 * 1024 * 1024,
  rows: 10000,
  rowCells: 500,
  cellText: 10000,
} as const;

export function isValidUUID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim()
    )
  );
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  return (
    email.length > 0 &&
    email.length <= VALIDATION_LIMITS.email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

export function isValidOTP(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value.trim());
}

export function isSafeFileName(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const name = value.trim();

  return (
    name.length > 0 &&
    name.length <= VALIDATION_LIMITS.fileName &&
    !name.includes("\0") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

export function isReasonableRows(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  if (value.length > VALIDATION_LIMITS.rows) return false;

  for (const row of value) {
    if (Array.isArray(row)) {
      if (row.length > VALIDATION_LIMITS.rowCells) return false;

      for (const cell of row) {
        if (
          typeof cell === "string" &&
          cell.length > VALIDATION_LIMITS.cellText
        ) {
          return false;
        }
      }
    } else if (row && typeof row === "object") {
      const values = Object.values(row as Record<string, unknown>);

      if (values.length > VALIDATION_LIMITS.rowCells) return false;

      for (const value of values) {
        if (
          typeof value === "string" &&
          value.length > VALIDATION_LIMITS.cellText
        ) {
          return false;
        }
      }
    } else if (
      typeof row === "string" &&
      row.length > VALIDATION_LIMITS.cellText
    ) {
      return false;
    }
  }

  return true;
}

export function isAllowedUploadFile(file: unknown): file is File {
  return (
    file instanceof File &&
    file.size > 0 &&
    file.size <= 25 * 1024 * 1024
  );
}
