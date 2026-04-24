import React from "react";
import { Eye, Download, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  canViewPdf: boolean;
  canDownloadReceipt: boolean;
  canAmend: boolean;
  loadingPdf: boolean;
  loadingReceipt: boolean;
  onViewPdf: () => void;
  onDownloadReceipt: () => void;
  onAmend: () => void;
}

const Slot: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="w-8 h-8 flex items-center justify-center">{children}</div>
);

const IconBtn: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, loading, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={onClick}
        disabled={disabled || loading}
        aria-label={label}
      >
        {loading ? <span className="text-[10px]">…</span> : children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
);

const InvoiceRowActions: React.FC<Props> = ({
  canViewPdf,
  canDownloadReceipt,
  canAmend,
  loadingPdf,
  loadingReceipt,
  onViewPdf,
  onDownloadReceipt,
  onAmend,
}) => {
  return (
    <div className="flex items-center gap-1 justify-end">
      <Slot>
        {canViewPdf ? (
          <IconBtn label="View invoice PDF" onClick={onViewPdf} loading={loadingPdf}>
            <Eye className="w-4 h-4" />
          </IconBtn>
        ) : null}
      </Slot>
      <Slot>
        {canDownloadReceipt ? (
          <IconBtn label="Download receipt PDF" onClick={onDownloadReceipt} loading={loadingReceipt}>
            <Download className="w-4 h-4" />
          </IconBtn>
        ) : null}
      </Slot>
      <Slot>
        {canAmend ? (
          <IconBtn label="Amend invoice" onClick={onAmend}>
            <Pencil className="w-4 h-4" />
          </IconBtn>
        ) : null}
      </Slot>
    </div>
  );
};

export default InvoiceRowActions;
