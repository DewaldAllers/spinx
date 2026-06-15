import { Buffer } from 'node:buffer';
import PDFDocument from 'pdfkit';

export type ReportRow = Record<string, string | number | boolean | null | Date>;

export function toCsv(rows: ReportRow[]) {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => {
    const text = value instanceof Date ? value.toISOString() : String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join(
    '\n',
  );
}

export async function toXlsx(rows: ReportRow[], _sheetName: string) {
  // Supabase-first reporting now exports from the mobile app. Keep this legacy
  // endpoint Excel-compatible without retaining the vulnerable ExcelJS chain.
  return Buffer.from(`\ufeff${toCsv(rows)}`, 'utf8');
}

export async function toPdf(rows: ReportRow[], title: string) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  doc.fontSize(18).text(title, { underline: false });
  doc.moveDown();
  doc.fontSize(9).fillColor('#222');

  if (rows.length === 0) {
    doc.text('No records found.');
  } else {
    const headers = Object.keys(rows[0] ?? {});
    doc.font('Helvetica-Bold').text(headers.join(' | '));
    doc.font('Helvetica').moveDown(0.5);
    rows.slice(0, 250).forEach((row) => {
      doc.text(headers.map((header) => String(row[header] ?? '')).join(' | '), {
        lineGap: 3,
      });
    });
    if (rows.length > 250) {
      doc.moveDown().text(`Showing first 250 of ${rows.length} records.`);
    }
  }

  doc.end();

  await new Promise<void>((resolve) => doc.on('end', resolve));
  return Buffer.concat(chunks);
}
