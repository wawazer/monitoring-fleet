
import { checkFleetAvailability } from "@/lib/fleetHelper";

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxICLEfVFaYQdZydstk4kwmZHipDNvTSxB2xj1DwATX9wHAmCCW8FZQf9SiwxiEgtlOnQ/exec?action=dashboard_json";

export async function POST(request: Request) {
  try {
    const input = await request.json();

    const response = await fetch(GAS_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Gagal mengambil data fleet dari GAS.");
    }

    const fleetData = await response.json();

    const result = checkFleetAvailability(fleetData, {
      startDate: input.startDate,
      startTime: input.startTime,
      endDate: input.endDate,
      endTime: input.endTime,
      passengers: input.passengers,
    });

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : String(error),
      },
      { status: 400 }
    );
  }
}
