import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, tokenMatches } from "@/lib/session-token";

/**
 * Optional password gate. When CAREERREACH_ACCESS_PASSWORD is set, every page, API route
 * and server action requires the auth cookie set by /login.
 */
export function proxy(request: NextRequest) {
  if (!process.env.CAREERREACH_ACCESS_PASSWORD) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  if (tokenMatches(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/") || request.method !== "GET") {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
