import { writeSecurityLog } from "./security-log";
import { handleHoneyTrap } from "./honey-trap";

const HONEYPOT_FIELDS = [
  "website",
  "company_website",
  "homepage",
  "url",
];

type HoneypotResult = {
  triggered: boolean;
  field: string | null;
};

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function checkHoneypot(body: unknown): HoneypotResult {
  if (!body || typeof body !== "object") {
    return {
      triggered: false,
      field: null,
    };
  }

  const data = body as Record<string, unknown>;

  for (const field of HONEYPOT_FIELDS) {
    if (getString(data[field]) !== "") {
      return {
        triggered: true,
        field,
      };
    }
  }

  return {
    triggered: false,
    field: null,
  };
}

export async function handleHoneypot(
  request: Request,
  body: unknown,
  userId?: string | null
): Promise<boolean> {
  const result = checkHoneypot(body);

  if (!result.triggered) {
    return false;
  }

  await writeSecurityLog({
    userId,
    eventType: "honeypot",
    action: "honeypot_triggered",
    success: false,
    request,
    metadata: {
      field: result.field,
      detection: "backend_honeypot",
    },
  });

  await handleHoneyTrap(
    request,
    userId,
    `honeypot_field_triggered:${result.field ?? "unknown"}`
  );

  return true;
}
