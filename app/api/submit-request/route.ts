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

//test
function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  try {
    const secret = process.env.PCAR_GAS_API_SECRET;
    const providedSecret = request.headers.get("x-pcar-internal-secret");

    if (!secret || secret.length < 32) {
      console.error("PCAR_GAS_API_SECRET belum dikonfigurasi dengan benar.");
      return jsonError("Konfigurasi server belum siap.", 500);
    }

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
      "name", "nipp", "email", "whatsapp", "department",
      "startDateTime", "endDateTime", "vehicle", "destination",
      "tripType", "loanType",
    ];

    const missingFields = requiredFields.filter((field) => {
      const value = data[field];
      return typeof value !== "string" || !value.trim();
    });

    if (missingFields.length > 0) {
      return Response.json(
        { ok: false, error: "Data pengajuan belum lengkap.", missingFields },
        { status: 400 }
      );
    }

    const gasUrl = new URL(gasUrlValue);
    gasUrl.search = "";
    gasUrl.hash = "";

    const gasPayload = JSON.stringify({
      action: "submit_ai_request",
      apiSecret: secret,
      data,
    });

    let lastDiagnostic = "Respons GAS tidak tersedia.";

    // ContentService GAS memakai redirect ke script.googleusercontent.com.
    // Respons HTML/redirect yang gagal dicoba ulang terbatas. Handler GAS
    // memiliki deduplikasi untuk pengajuan AI identik agar retry tidak membuat
    // baris duplikat pada kondisi normal.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let gasResponse: Response | null = null;
      let responseText = "";
      let contentType = "unknown";

      try {
        gasResponse = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: gasPayload,
          cache: "no-store",
          redirect: "follow",
        });
        responseText = await gasResponse.text();
        contentType = gasResponse.headers.get("content-type") || "unknown";

        let result: GASSubmitResult | null = null;
        try {
          result = JSON.parse(responseText) as GASSubmitResult;
        } catch {
          result = null;
        }

        if (result) {
          if (!gasResponse.ok || !result.ok) {
            // Ini respons JSON aplikasi yang eksplisit, bukan masalah redirect;
            // jangan mengulang agar tidak mengubah interpretasi error bisnis.
            return Response.json(
              { ok: false, error: result.error || "Pengajuan gagal diproses oleh GAS." },
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
        }

        const responsePreview = responseText.replace(/\s+/g, " ").slice(0, 400);
        lastDiagnostic = `HTTP ${gasResponse.status}; ${contentType}; URL ${gasResponse.url || gasUrl.toString()}`;
        console.error("[P-CAR] GAS respons non-JSON", {
          attempt,
          maxAttempts,
          status: gasResponse.status,
          statusText: gasResponse.statusText,
          contentType,
          redirected: gasResponse.redirected,
          finalUrl: gasResponse.url,
          responsePreview,
        });
      } catch (fetchError) {
        lastDiagnostic = String(fetchError instanceof Error ? fetchError.message : fetchError);
        console.error("[P-CAR] Fetch GAS gagal", { attempt, maxAttempts, error: lastDiagnostic });
      }

      if (attempt < maxAttempts) {
        await sleep(attempt === 1 ? 800 : 1600);
      }
    }

    // Jangan mengklaim pengajuan pasti gagal: GAS mungkin sudah menulis baris
    // sebelum respons JSON gagal dikirim. Pemohon/admin perlu cek Request Mobil.
    return Response.json(
      {
        ok: false,
        uncertain: true,
        error: "GAS belum mengembalikan respons JSON setelah 3 percobaan. Pengajuan mungkin sudah tercatat; periksa Request Mobil sebelum mencoba lagi.",
        diagnostic: lastDiagnostic,
      },
      { status: 502 }
    );
  } catch (error) {
    console.error("P-CAR submit gateway error:", error);
    return jsonError("Terjadi kesalahan saat mengirim pengajuan ke P-CAR.", 500);
  }
}
