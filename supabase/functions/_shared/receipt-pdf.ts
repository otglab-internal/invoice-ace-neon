import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";

interface LineItem {
  description?: string;
  quantity?: number;
  cost?: number;
}

interface ReceiptPdfData {
  invoiceNumber: string | null;
  contactName: string;
  invoiceDate: string;
  reference: string | null;
  total: number;
  lineItems: LineItem[];
  submittedByName: string;
  currency?: string;
  logoUrl?: string | null;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 56.69;
const LIGHT_GRAY = rgb(0.92, 0.92, 0.92);
const MID_GRAY = rgb(0.78, 0.78, 0.78);
const TEXT_GRAY = rgb(0.39, 0.39, 0.39);
const TEXT_DARK = rgb(0.16, 0.16, 0.16);

function formatCurrency(amount: number, currency = "RM") {
  return `${currency} ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const source = (text || "—").replace(/\\n/g, "\n");
  const paragraphs = source.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }

  return lines.length > 0 ? lines : ["—"];
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (contentType.includes("png")) return { bytes, type: "png" };
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return { bytes, type: "jpg" };

    const lower = url.toLowerCase();
    if (lower.endsWith(".png")) return { bytes, type: "png" };
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return { bytes, type: "jpg" };
    return null;
  } catch {
    return null;
  }
}

export async function createReceiptPdfBytes(data: ReceiptPdfData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  const pageWidth = page.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  const leftCol = MARGIN;
  const rightCol = pageWidth / 2 + 28;
  const colDesc = MARGIN + 6;
  const colQty = pageWidth - MARGIN - 198;
  const colRate = pageWidth - MARGIN - 119;
  const colAmt = pageWidth - MARGIN - 6;
  const descMaxWidth = colQty - colDesc - 12;
  const currency = data.currency || "RM";

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    options: { size?: number; font?: any; color?: any; align?: "left" | "right" } = {},
  ) => {
    const size = options.size ?? 9;
    const font = options.font ?? regular;
    const color = options.color ?? TEXT_DARK;
    const width = font.widthOfTextAtSize(text, size);
    const drawX = options.align === "right" ? x - width : x;
    page.drawText(text, { x: drawX, y: yPos, size, font, color });
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number, color = MID_GRAY, thickness = 0.6) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });
  };

  const drawField = (label: string, value: string, x: number, topY: number) => {
    drawText(label, x, topY, { size: 9, font: bold, color: TEXT_GRAY });
    drawText(value, x, topY - 14, { size: 9, font: regular, color: TEXT_DARK });
  };

  const drawTableHeader = (topY: number) => {
    page.drawRectangle({ x: MARGIN, y: topY - 18, width: contentWidth, height: 18, color: LIGHT_GRAY });
    drawText("Description", colDesc, topY - 11, { size: 8, font: bold, color: TEXT_GRAY });
    drawText("Qty", colQty, topY - 11, { size: 8, font: bold, color: TEXT_GRAY, align: "right" });
    drawText("Rate", colRate, topY - 11, { size: 8, font: bold, color: TEXT_GRAY, align: "right" });
    drawText("Amount", colAmt, topY - 11, { size: 8, font: bold, color: TEXT_GRAY, align: "right" });
  };

  if (data.logoUrl) {
    const image = await fetchImageBytes(data.logoUrl);
    if (image) {
      try {
        const embedded = image.type === "png" ? await pdfDoc.embedPng(image.bytes) : await pdfDoc.embedJpg(image.bytes);
        page.drawImage(embedded, { x: MARGIN, y: y - 12, width: 113, height: 45 });
      } catch {
        // Skip invalid logo assets.
      }
    }
  }

  drawText("PAYMENT RECEIPT", pageWidth - MARGIN, y - 2, { size: 22, font: bold, align: "right" });
  y -= 46;

  drawLine(MARGIN, y, pageWidth - MARGIN, y);
  y -= 22;

  drawField("Invoice Number", data.invoiceNumber || "—", leftCol, y);
  drawField("Date", data.invoiceDate, rightCol, y);
  y -= 42;

  drawField("Bill To", data.contactName, leftCol, y);
  if (data.reference) {
    drawField("Reference", data.reference, rightCol, y);
  }
  y -= 42;

  drawField("Submitted By", data.submittedByName, leftCol, y);
  drawField("Status", "PAID", rightCol, y);
  y -= 34;

  drawTableHeader(y);
  y -= 28;

  for (const item of data.lineItems) {
    const qty = Number(item.quantity) || 0;
    const cost = Number(item.cost) || 0;
    const lineTotal = qty * cost;
    const lines = wrapText(item.description || "—", descMaxWidth, regular, 9);
    const rowHeight = Math.max(lines.length * 14, 18);

    if (y - rowHeight < 110) {
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
      drawTableHeader(y);
      y -= 28;
    }

    for (let i = 0; i < lines.length; i++) {
      drawText(lines[i], colDesc, y - 2 - i * 14, { size: 9, font: regular });
      if (i === 0) {
        drawText(String(qty), colQty, y - 2, { size: 9, font: regular, align: "right" });
        drawText(formatCurrency(cost, currency), colRate, y - 2, { size: 9, font: regular, align: "right" });
        drawText(formatCurrency(lineTotal, currency), colAmt, y - 2, { size: 9, font: regular, align: "right" });
      }
    }

    y -= rowHeight;
    drawLine(MARGIN, y, pageWidth - MARGIN, y, LIGHT_GRAY, 0.8);
    y -= 12;
  }

  y -= 8;
  drawLine(colQty - 56, y, pageWidth - MARGIN, y);
  y -= 20;
  drawText("TOTAL PAID", colRate - 56, y, { size: 11, font: bold, align: "right" });
  drawText(formatCurrency(data.total, currency), colAmt, y, { size: 11, font: bold, align: "right" });

  y -= 34;
  drawLine(MARGIN, y, pageWidth - MARGIN, y);
  y -= 18;
  drawText("This receipt confirms payment has been received. Thank you for your business.", MARGIN, y, { size: 8, font: regular, color: MID_GRAY });

  return await pdfDoc.save();
}
