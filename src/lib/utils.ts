import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns current date/time in GMT+8 as an ISO string */
export function nowGMT8(): string {
  const now = new Date();
  const gmt8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return gmt8.toISOString();
}

/** Formats a numeric amount with thousands separators and 2 decimal places. */
export function formatAmount(amount: number | string | null | undefined): string {
  const value = Number(amount) || 0;
  return value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
