import React from "react";
import { Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  canViewPdf: boolean;
  canAmend: boolean;
  loadingPdf: boolean;
  onViewPdf: () => void;
  onAmend: () => void;
  /** Rendered receipt dropdown menu (per-payment receipts). */
  receiptSlot?: React.ReactNode;
}

const IconBtn: React.FC<{
  label: string;
  available: boolean;
  onClick: () => void;
  loading?: boolean;
  children: React.ReactNode;
}> = ({ label, available, onClick, loading, children }) => {
  const btn = (
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 ${
        available
          ? "text-primary hover:text-primary hover:bg-primary/10"
          : "text-muted-foreground/30 cursor-not-allowed hover:bg-transparent"
      }`}
      onClick={available ? onClick : undefined}
      disabled={loading}
      aria-label={label}
      aria-disabled={!available}
    >
      {loading ? <span className="text-[10px]">…</span> : children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="top">{available ? label : `${label} (unavailable)`}</TooltipContent>
    </Tooltip>
  );
};

const InvoiceRowActions: React.FC<Props> = ({
  canViewPdf,
  canAmend,
  loadingPdf,
  onViewPdf,
  onAmend,
  receiptSlot,
}) => {
  return (
    <div className="flex items-center gap-1 justify-start">
      <IconBtn label="View invoice PDF" available={canViewPdf} onClick={onViewPdf} loading={loadingPdf}>
        <Eye className="w-4 h-4" />
      </IconBtn>
      {receiptSlot}
      <IconBtn label="Amend invoice" available={canAmend} onClick={onAmend}>
        <Pencil className="w-4 h-4" />
      </IconBtn>
    </div>
  );
};

export default InvoiceRowActions;
