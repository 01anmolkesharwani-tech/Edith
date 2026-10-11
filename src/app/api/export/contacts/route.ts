import { activeProfileId } from "@/lib/session";
import { EXPORT_FIELDS, exportContactsCsv, type ExportField } from "@/lib/services/csv-import";

export async function GET(req: Request) {
  try {
    const id = await activeProfileId();
    const url = new URL(req.url);
    const fields = url.searchParams.getAll("field").filter((f): f is ExportField => f in EXPORT_FIELDS);
    const ids = url.searchParams.getAll("id").slice(0, 2000);
    const csv = await exportContactsCsv(id, fields, ids);
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="careerreach-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
