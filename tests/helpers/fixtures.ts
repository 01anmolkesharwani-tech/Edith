import type { FetchOptions, FetchResult, Fetcher } from "@/lib/net/safe-fetch";

export interface FixturePage {
  status?: number;
  body: string;
  contentType?: string;
  finalUrl?: string;
  headers?: Record<string, string>;
}

/** A Fetcher backed by an in-memory map. Unknown URLs return 404. Records every request. */
export function fixtureFetcher(pages: Record<string, FixturePage | (() => FixturePage)>) {
  const calls: { url: string; opts?: FetchOptions }[] = [];
  const fetcher: Fetcher = async (url, opts) => {
    calls.push({ url, opts });
    const entry = pages[url] ?? pages[url.replace(/\/$/, "")] ?? pages[`${url}/`];
    const page = typeof entry === "function" ? entry() : entry;
    const result: FetchResult = {
      url,
      finalUrl: page?.finalUrl ?? url,
      status: page ? (page.status ?? 200) : 404,
      contentType: page?.contentType ?? "text/html; charset=utf-8",
      body: page?.body ?? "Not found",
      truncated: false,
      headers: page?.headers ?? {},
      retrievedAt: new Date(),
    };
    return result;
  };
  return { fetcher, calls };
}

/** Build a tiny but valid single-page PDF containing the given text. */
export function makePdf(text: string): Uint8Array {
  const esc = text.replace(/[()\\]/g, (m) => `\\${m}`);
  const content = `BT /F1 12 Tf 72 720 Td (${esc}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
