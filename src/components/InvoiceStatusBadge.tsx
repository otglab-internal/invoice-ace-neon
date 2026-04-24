import React from "react";

interface Props {
  status: string;
  amendmentStatus?: string | null;
}

type Tone = "success" | "warning" | "danger" | "muted" | "info" | "amber";

const toneClass: Record<Tone, string> = {
  success: "bg-success/10 text-success ring-1 ring-inset ring-success/20",
  warning: "bg-warning/10 text-warning ring-1 ring-inset ring-warning/20",
  danger: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
  muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  info: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  amber: "bg-orange-500/10 text-orange-600 ring-1 ring-inset ring-orange-500/20",
};

function resolve(status: string, amendmentStatus?: string | null): { label: string; tone: Tone } {
  if (amendmentStatus === "pending") return { label: "Amendment", tone: "amber" };
  switch (status) {
    case "paid":
      return { label: "Paid", tone: "success" };
    case "partially_paid":
      return { label: "Partial", tone: "warning" };
    case "pending_approval":
      return { label: "Pending", tone: "muted" };
    case "approved":
      return { label: "Approved", tone: "info" };
    case "submitted":
      return { label: "Submitted", tone: "info" };
    case "pushed":
      return { label: "Pushed", tone: "info" };
    case "rejected":
      return { label: "Rejected", tone: "danger" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    default:
      return { label: status.replace(/_/g, " "), tone: "muted" };
  }
}

const InvoiceStatusBadge: React.FC<Props> = ({ status, amendmentStatus }) => {
  const { label, tone } = resolve(status, amendmentStatus);
  return (
    <span
      className={`inline-flex w-[96px] justify-center items-center px-2 py-0.5 rounded-full text-[11px] font-medium tracking-wide ${toneClass[tone]}`}
    >
      {label}
    </span>
  );
};

export default InvoiceStatusBadge;
