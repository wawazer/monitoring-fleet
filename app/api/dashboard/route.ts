const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxICLEfVFaYQdZydstk4kwmZHipDNvTSxB2xj1DwATX9wHAmCCW8FZQf9SiwxiEgtlOnQ/exec?action=dashboard_json";

export async function GET() {
  try {
    const response = await fetch(GAS_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json(
        {
          error: `Google Apps Script error: ${response.status}`,
        },
        {
          status: response.status,
        }
      );
    }

    const data = await response.json();

    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GAS ERROR:", error);

    return Response.json(
      {
        error: "Gagal mengambil data dari Google Apps Script",
      },
      {
        status: 500,
      }
    );
  }
}