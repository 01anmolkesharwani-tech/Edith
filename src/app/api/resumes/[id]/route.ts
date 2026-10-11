import { activeProfileId } from "@/lib/session";
import { readResumeFile } from "@/lib/services/resumes";

/** Serve a résumé PDF for preview — only to the profile that owns it. */
export async function GET(_req: Request, ctx: RouteContext<"/api/resumes/[id]">) {
  const { id } = await ctx.params;
  try {
    const profileId = await activeProfileId();
    const { bytes, resume } = await readResumeFile(profileId, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${resume.originalFilename.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
