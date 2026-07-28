import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gatherExportData } from "@/lib/export/gather";
import {
  buildWorkbook,
  workbookToBuffer,
  exportFilename,
} from "@/lib/export/workbook";

export const dynamic = "force-dynamic";
// ExcelJS needs Node APIs; it will not run on the edge runtime.
export const runtime = "nodejs";

/**
 * Monthly meeting report.
 *
 * The admin role is re-verified here rather than trusted from middleware.
 * Beyond that, the queries run as the signed-in user, so Row Level Security is
 * still the thing deciding which rows land in the workbook - a bug in this
 * route cannot widen what it can see.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const year = Number(params.get("year"));
  const month = Number(params.get("month"));
  const consultantParam = params.get("consultant");

  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return NextResponse.json(
      { error: "Provide a valid year and month" },
      { status: 400 },
    );
  }

  const consultantId =
    consultantParam && consultantParam !== "all" ? consultantParam : null;

  if (
    consultantId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      consultantId,
    )
  ) {
    return NextResponse.json({ error: "Invalid consultant" }, { status: 400 });
  }

  try {
    const data = await gatherExportData({
      year,
      month,
      consultantId,
      generatedBy: profile.full_name,
    });

    const workbook = await buildWorkbook(data);
    const buffer = await workbookToBuffer(workbook);
    const filename = exportFilename(year, month, data.scopeLabel);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[export] failed to build workbook", error);
    return NextResponse.json(
      { error: "The report could not be generated" },
      { status: 500 },
    );
  }
}
