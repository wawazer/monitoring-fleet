
import { NextResponse } from "next/server";

let latestFleetData: unknown = null;

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Fleet API aktif",
    data: latestFleetData
  });
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();

    if (
      !body ||
      typeof body !== "object" ||
      !("data" in body)
    ) {
      return NextResponse.json(
        { success: false, error: "Data fleet tidak valid." },
        { status: 400 }
      );
    }

    latestFleetData = body.data;

    console.log("Data fleet diterima.");

    return NextResponse.json({
      success: true,
      message: "Data fleet diterima."
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Gagal membaca data fleet." },
      { status: 400 }
    );
  }
}


//add