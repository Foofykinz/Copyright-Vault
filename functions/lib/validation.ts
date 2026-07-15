import { PLATFORMS, type Platform } from "../../shared/types";
import { ValidationError } from "./http";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function requireString(value: unknown, field: string, opts: { maxLength?: number } = {}): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`, { [field]: "required" });
  }
  const trimmed = value.trim();
  if (opts.maxLength && trimmed.length > opts.maxLength) {
    throw new ValidationError(`${field} must be ${opts.maxLength} characters or fewer.`, { [field]: "too_long" });
  }
  return trimmed;
}

export function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function requirePlatform(value: unknown): Platform {
  if (typeof value !== "string" || !PLATFORMS.includes(value as Platform)) {
    throw new ValidationError(`platform must be one of: ${PLATFORMS.join(", ")}.`, { platform: "invalid" });
  }
  return value as Platform;
}

export function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw new ValidationError(`${field} must be a valid ISO date (YYYY-MM-DD or full ISO datetime).`, {
      [field]: "invalid",
    });
  }
  return value;
}

export function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireIsoDate(value, field);
}

export function requireUrl(value: unknown, field: string): string {
  const str = requireString(value, field);
  try {
    new URL(str);
  } catch {
    throw new ValidationError(`${field} must be a valid URL.`, { [field]: "invalid_url" });
  }
  return str;
}

export function optionalUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireUrl(value, field);
}

export function optionalNonNegativeInt(value: unknown, field: string, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
    throw new ValidationError(`${field} must be a non-negative integer.`, { [field]: "invalid" });
  }
  return num;
}

export function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ValidationError(`${field} must be an array of strings.`, { [field]: "invalid" });
  }
  return value as string[];
}
