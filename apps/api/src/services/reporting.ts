import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';
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

export async function toXlsx(rows: ReportRow[], sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SpinX';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Report');
  const headers = Object.keys(rows[0] ?? { empty: '' });
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 3),
  }));
  rows.forEach((row) => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
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
