import jsPDF from "jspdf";

interface LineItem {
  description?: string;
  quantity?: number;
  cost?: number;
  account?: string;
  center?: string;
}

interface ReceiptData {
  invoiceNumber: string | null;
  contactName: string;
  invoiceDate: string;
  reference: string | null;
  total: number;
  lineItems: LineItem[];
  submittedByName: string;
  currency?: string;
  logoUrl?: string | null;
  orgName?: string | null;
  companyName?: string | null;
  companySsm?: string | null;
  companyAddress?: string | null;
}

function formatCurrency(amount: number | string | null | undefined, currency = "RM") {
  const value = Number(amount) || 0;
  return `${currency} ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateReceiptPdf(data: ReceiptData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  // Logo
  if (data.logoUrl) {
    const imgData = await loadImageAsDataUrl(data.logoUrl);
    if (imgData) {
      try {
        doc.addImage(imgData, "PNG", margin, y, 40, 16);
      } catch { /* skip if image fails */ }
    }
  }

  // Title - right aligned
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("PAYMENT RECEIPT", pageWidth - margin, y + 8, { align: "right" });

  y += 20;

  // Company block (right aligned, under title)
  const companyLines: string[] = [];
  if (data.companyName) companyLines.push(data.companyName);
  if (data.companySsm) companyLines.push(`Reg. No: ${data.companySsm}`);
  if (data.companyAddress) {
    const addrLines = data.companyAddress.split(/\r?\n/).flatMap((line) =>
      doc.splitTextToSize(line, 80) as string[],
    );
    companyLines.push(...addrLines);
  }

  if (companyLines.length > 0) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    for (let i = 0; i < companyLines.length; i++) {
      const isFirst = i === 0;
      doc.setFont("helvetica", isFirst ? "bold" : "normal");
      doc.text(companyLines[i], pageWidth - margin, y + 4 + i * 4, { align: "right" });
    }
    y += 4 + companyLines.length * 4 + 4;
  } else {
    y += 8;
  }

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Receipt details - two columns
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);

  const leftCol = margin;
  const rightCol = pageWidth / 2 + 10;

  const addField = (label: string, value: string, x: number, yPos: number) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text(label, x, yPos);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    doc.text(value, x, yPos + 5);
  };

  addField("Invoice Number", data.invoiceNumber || "—", leftCol, y);
  addField("Date", data.invoiceDate, rightCol, y);
  y += 16;

  addField("Bill To", data.contactName, leftCol, y);
  if (data.reference) {
    addField("Reference", data.reference, rightCol, y);
  }
  y += 16;

  addField("Submitted By", data.submittedByName, leftCol, y);
  addField("Status", "PAID", rightCol, y);
  y += 16;

  // Line items table
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, pageWidth - margin * 2, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);

  const colDesc = margin + 2;
  const colQty = pageWidth - margin - 70;
  const colRate = pageWidth - margin - 42;
  const colAmt = pageWidth - margin - 2;

  doc.text("Description", colDesc, y + 5.5);
  doc.text("Qty", colQty, y + 5.5, { align: "right" });
  doc.text("Rate", colRate, y + 5.5, { align: "right" });
  doc.text("Amount", colAmt, y + 5.5, { align: "right" });

  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);

  const currency = data.currency || "RM";

  for (const item of data.lineItems) {
    const qty = Number(item.quantity) || 0;
    const cost = Number(item.cost) || 0;
    const lineTotal = qty * cost;

    const desc = (item.description || "—").replace(/\\n/g, "\n");
    const descLines = doc.splitTextToSize(desc, colQty - colDesc - 10);

    for (let i = 0; i < descLines.length; i++) {
      doc.text(descLines[i], colDesc, y + 4);
      if (i === 0) {
        doc.text(qty.toString(), colQty, y + 4, { align: "right" });
        doc.text(formatCurrency(cost, currency), colRate, y + 4, { align: "right" });
        doc.text(formatCurrency(lineTotal, currency), colAmt, y + 4, { align: "right" });
      }
      y += 5;
    }

    // Row divider
    doc.setDrawColor(235, 235, 235);
    doc.line(margin, y + 1, pageWidth - margin, y + 1);
    y += 4;
  }

  // Total
  y += 4;
  doc.setDrawColor(200, 200, 200);
  doc.line(colQty - 20, y, pageWidth - margin, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL PAID", colRate - 20, y, { align: "right" });
  doc.text(formatCurrency(data.total, currency), colAmt, y, { align: "right" });

  y += 20;

  // Footer
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("This receipt confirms payment has been received. Thank you for your business.", margin, y);

  // Download
  const filename = `Receipt_${data.invoiceNumber || "unknown"}.pdf`;
  doc.save(filename);
}
