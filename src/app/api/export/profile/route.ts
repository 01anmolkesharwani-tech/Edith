import { activeProfileId } from "@/lib/session";
import { exportProfileData } from "@/lib/services/data";

export async function GET() {
  try {
    const id = await activeProfileId();
    const data = await exportProfileData(id);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="careerreach-${data.profile.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
