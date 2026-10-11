export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GASSubmitResult = {
  ok?: boolean;
  error?: string;
  row?: number;
  status?: string;
  duplicate?: boolean;
  message?: string;
};

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    const secret = process.env.PCAR_GAS_API_SECRET;
    const providedSecret = request.headers.get("x-pcar-internal-secret");

    if (!secret || secret.length < 32) {
      console.error("PCAR_GAS_API_SECRET belum dikonfigurasi dengan benar.");
      return jsonError("Konfigurasi server belum siap.", 500);
    }

    // Endpoint ini hanya boleh dipanggil dari route server /api/chat.
    if (!providedSecret || providedSecret !== secret) {
      return jsonError("Akses tidak diizinkan.", 401);
    }

    const gasUrlValue = process.env.PCAR_GAS_WEBAPP_URL;
    if (!gasUrlValue) {
      console.error("PCAR_GAS_WEBAPP_URL belum dikonfigurasi.");
      return jsonError("Konfigurasi backend P-CAR belum siap.", 500);
    }

    const body = await request.json();
    const data = body?.data;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return jsonError("Data pengajuan tidak valid.", 400);
    }

    const requiredFields = [
      "name",
      "nipp",
      "email",
      "whatsapp",
      "department",
      "startDateTime",
      "endDateTime",
      "vehicle",
      "destination",
      "tripType",
      "loanType",
    ];

    const missingFields = requiredFields.filter((field) => {
      const value = data[field];
      return typeof value !== "string" || !value.trim();
    });

    if (missingFields.length > 0) {
      return Response.json(
        {
          ok: false,
          error: "Data pengajuan belum lengkap.",
          missingFields,
        },
        { status: 400 }
      );
    }

    // Gunakan URL deployment GAS tanpa query string action=dashboard_json.
    const gasUrl = new URL(gasUrlValue);
    gasUrl.search = "";
    gasUrl.hash = "";

    const gasResponse = await fetch(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action: "submit_ai_request",
        apiSecret: secret,
        data,
      }),
      cache: "no-store",
      redirect: "follow",
    });

    const responseText = await gasResponse.text();
    const gasContentType = gasResponse.headers.get("content-type") || "unknown";
    let result: GASSubmitResult;

    try {
      result = JSON.parse(responseText) as GASSubmitResult;
    } catch {
      // Jangan menampilkan isi respons mentah ke browser karena respons HTML
      // bisa berisi detail teknis. Simpan cuplikan terbatas di Vercel Logs.
      const responsePreview = responseText.replace(/\s+/g, " ").slice(0, 400);
      console.error("[P-CAR] GAS mengembalikan respons non-JSON", {
        status: gasResponse.status,
        statusText: gasResponse.statusText,
        contentType: gasContentType,
        finalUrl: gasResponse.url,
        responsePreview,
      });

      let hint = "Periksa Vercel Function Logs dan deployment Web App GAS.";
      if (/script function not found.*doPost/i.test(responseText)) {
        hint = "Versi Web App GAS yang aktif belum memiliki doPost(e). Deploy New version.";
      } else if (/accounts\.google\.com|sign in|signin|login/i.test(responseText)) {
        hint = "GAS meminta login; periksa akses Web App agar dapat diakses siapa saja sesuai kebijakan aplikasi.";
      } else if (/exception|error|not found/i.test(responseText)) {
        hint = "GAS mengembalikan halaman error; periksa cuplikan respons di Vercel Function Logs.";
      }

      return jsonError(
        `GAS tidak mengembalikan JSON (HTTP ${gasResponse.status}; ${gasContentType}). ${hint}`,
        502
      );
    }

    if (!gasResponse.ok || !result.ok) {
      return Response.json(
        {
          ok: false,
          error: result.error || "Pengajuan gagal diproses oleh GAS.",
        },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      row: result.row,
      status: result.status,
      duplicate: result.duplicate ?? false,
      message: result.message,
    });
  } catch (error) {
    console.error("P-CAR submit gateway error:", error);
    return jsonError("Terjadi kesalahan saat mengirim pengajuan ke P-CAR.", 500);
  }
}
