/**
 * P-CAR Fleet Assistant chat API.
 * Requires GEMINI_API_KEY and a deployed app/api/submit-request/route.ts.
 * Submit gateway uses server-only PCAR_GAS_WEBAPP_URL and PCAR_GAS_API_SECRET.
 */



import { GoogleGenerativeAI } from "@google/generative-ai";

import { checkFleetAvailability } from "@/lib/fleetHelper";

import { FLEET_SYSTEM_RULES } from "@/lib/fleetRules";

const GAS_URL =

  "https://script.google.com/macros/s/AKfycbxICLEfVFaYQdZydstk4kwmZHipDNvTSxB2xj1DwATX9wHAmCCW8FZQf9SiwxiEgtlOnQ/exec?action=dashboard_json";

type ChatMessage = {

  role: "user" | "assistant";

  content: string;

};

type Intent = {

  isFleetRequest: boolean;

  startDate: string | null;

  startTime: string | null;

  endDate: string | null;

  endTime: string | null;

  passengers: number | null;

  selectedVehicle: string | null;

  destination: string | null;

  purpose: string | null;

  applicantName: string | null;

  nipp: string | null;

  email: string | null;

  whatsapp: string | null;

  department: string | null;

  tripType: string | null;

  loanType: string | null;

  guestList: string | null;

  hotel: string | null;

  urgentReason: string | null;

  sppdReference: string | null;

  sppdFileUrl: string | null;

  bookingConfirmation: boolean;

};

function parseJson(text: string): Intent {

  const start = text.indexOf("{");

  const end = text.lastIndexOf("}");

  if (start < 0 || end < start) {

    throw new Error("AI tidak memberikan format data yang valid.");

  }

  return JSON.parse(text.slice(start, end + 1)) as Intent;

}

function validDate(value: unknown): value is string {

  if (typeof value !== "string") return false;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (

    !Number.isNaN(date.getTime()) &&

    date.toISOString().slice(0, 10) === value

  );

}

function validTime(value: unknown): value is string {

  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {

    return false;

  }

  const [hour, minute] = value.split(":").map(Number);

  return (

    hour >= 0 &&

    hour <= 23 &&

    minute >= 0 &&

    minute <= 59

  );

}

function addOneHour(date: string, time: string) {

  const [hour, minute] = time.split(":").map(Number);

  const total = hour * 60 + minute + 60;

  if (total < 1440) {

    return {

      endDate: date,

      endTime: `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(

        total % 60

      ).padStart(2, "0")}`,

    };

  }

  const nextDate = new Date(`${date}T00:00:00Z`);

  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  return {

    endDate: nextDate.toISOString().slice(0, 10),

    endTime: `${String(Math.floor((total - 1440) / 60)).padStart(

      2,

      "0"

    )}:${String((total - 1440) % 60).padStart(2, "0")}`,

  };

}

function normalize(value: unknown) {

  return String(value ?? "").trim().toLowerCase();

}

export async function POST(request: Request) {

  try {

    const body = await request.json();

    const message = body.message;

    if (typeof message !== "string" || !message.trim()) {

      return Response.json(

        { success: false, error: "Pesan tidak boleh kosong." },

        { status: 400 }

      );

    }

    const history: ChatMessage[] = Array.isArray(body.history)

      ? body.history

          .filter(

            (item: any) =>

              (item.role === "user" || item.role === "assistant") &&

              typeof item.content === "string"

          )

          .slice(-12)

      : [];

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {

      throw new Error("GEMINI_API_KEY belum dikonfigurasi.");

    }

    // 1. Ambil data fleet terbaru

    const fleetResponse = await fetch(GAS_URL, {

      cache: "no-store",

    });

    if (!fleetResponse.ok) {

      throw new Error("Gagal mengambil data fleet dari GAS.");

    }

    const fleetData = await fleetResponse.json();

    if (

      !Array.isArray(fleetData.units) ||

      !Array.isArray(fleetData.days) ||

      fleetData.days.length === 0

    ) {

      throw new Error("Struktur data fleet tidak valid.");

    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({

      model: "gemini-3.5-flash-lite",

    });

    // 2. Pahami pesan berdasarkan seluruh percakapan

    const transcript = [

      ...history,

      { role: "user", content: message },

    ];

    const intentPrompt = `

Kamu adalah parser untuk P-CAR Fleet Assistant.

Tanggal lokal hari ini: ${fleetData.days[0]}

Tanggal yang tersedia dalam data: ${JSON.stringify(fleetData.days)}

Pahami seluruh transkrip berikut, terutama pesan user terbaru.
Pertahankan tanggal, jam, jumlah penumpang, unit pilihan, tujuan,
keperluan, dan data pemohon yang sudah diberikan sebelumnya.
Jangan mengarang nama, NIPP, email, WhatsApp, unit kerja, atau tipe perjalanan.
Jika belum disebutkan, isi null.

Aturan:

- "Besok" adalah satu hari setelah tanggal lokal hari ini.

- "Lusa" adalah dua hari setelah tanggal lokal hari ini.

- "Jam 9 pagi" berarti 09:00.

- Jika user memilih "nomor 1", cocokkan dengan rekomendasi kendaraan

  yang benar-benar muncul dalam transkrip. Jangan mengarang unit.

- Bedakan tujuan perjalanan dari keperluan perjalanan.
- applicantName adalah nama lengkap pemohon.
- tripType pertahankan pilihan/istilah persis yang diberikan user; jika user
  memilih URGENT, isi persis "URGENT". Jangan mengubah perjalanan biasa menjadi URGENT.
- loanType gunakan "Dengan Driver" atau "Lepas Kunci" jika jelas dari transkrip.
- Jika informasi SPPD, daftar tamu, atau hotel belum diberikan, gunakan null.
- sppdFileUrl hanya isi jika user memberikan link https yang jelas untuk file SPPD.

- bookingConfirmation hanya true jika PESAN USER TERBARU jelas

  menyatakan setuju mengonfirmasi draft, misalnya "iya, konfirmasi".

- Persetujuan hanya berarti persetujuan terhadap draft, bukan booking

  sudah dibuat di sistem.

- Jika sebuah informasi tidak pernah diberikan dan tidak bisa

  disimpulkan, gunakan null.

- isFleetRequest true untuk pencarian atau pembahasan pengajuan kendaraan.

Transkrip:

${JSON.stringify(transcript)}

Balas HANYA JSON valid:

{

  "isFleetRequest": true,

  "startDate": "YYYY-MM-DD atau null",

  "startTime": "HH:mm atau null",

  "endDate": "YYYY-MM-DD atau null",

  "endTime": "HH:mm atau null",

  "passengers": 8,

  "selectedVehicle": "nama unit lengkap atau null",

  "destination": "tujuan atau null",

  "purpose": "keperluan/perihal atau null",

  "applicantName": "nama lengkap pemohon atau null",

  "nipp": "NIPP sebagai teks atau null",

  "email": "email pemohon atau null",

  "whatsapp": "nomor WhatsApp atau null",

  "department": "unit kerja/departemen atau null",

  "tripType": "tipe perjalanan sesuai pilihan P-CAR atau null",

  "loanType": "Dengan Driver / Lepas Kunci atau null",

  "guestList": "daftar tamu atau null",

  "hotel": "hotel menginap atau null",

  "urgentReason": "alasan URGENT atau null",

  "sppdReference": "dasar/nomor SPPD atau null",

  "sppdFileUrl": "link HTTPS file SPPD atau null",

  "bookingConfirmation": false

}

`;

    const intentResult = await model.generateContent(intentPrompt);

    const intent = parseJson(intentResult.response.text());

    // 3. Pesan biasa tidak harus memulai proses pencarian

    if (!intent.isFleetRequest) {

      const greeting = await model.generateContent(`

${FLEET_SYSTEM_RULES}

Jawab pesan berikut secara natural dalam Bahasa Indonesia.

Jangan mengaku sudah membuat booking atau melakukan tindakan backend.

Pesan:

${message.trim()}

`);

      return Response.json({

        success: true,

        reply: greeting.response.text(),

      });

    }

    // 4. Minta detail waktu jika belum lengkap

    if (!validDate(intent.startDate) || !validTime(intent.startTime)) {

      return Response.json({

        success: true,

        needs_clarification: true,

        reply:

          "Baik, saya bantu. Tanggal dan jam berapa kendaraan akan berangkat?",

      });

    }

    const assumedOneHour = !intent.endTime;

    const defaultEnd = assumedOneHour

      ? addOneHour(intent.startDate, intent.startTime)

      : {

          endDate: intent.endDate || intent.startDate,

          endTime: intent.endTime!,

        };

    const endDate = defaultEnd.endDate;

    const endTime = defaultEnd.endTime;

    if (!validDate(endDate) || !validTime(endTime)) {

      return Response.json({

        success: true,

        needs_clarification: true,

        reply:

          "Tanggal atau jam kembali belum jelas. Kapan kendaraan akan dikembalikan?",

      });

    }

    if (

      !fleetData.days.includes(intent.startDate) ||

      !fleetData.days.includes(endDate)

    ) {

      return Response.json({

        success: true,

        needs_clarification: true,

        reply: `Data jadwal saat ini mencakup ${fleetData.days[0]} hingga ${

          fleetData.days[fleetData.days.length - 1]

        }. Silakan pilih tanggal dalam rentang tersebut.`,

      });

    }

    // 5. Backend memeriksa ketersediaan secara deterministik

    const availability = checkFleetAvailability(fleetData, {

      startDate: intent.startDate,

      startTime: intent.startTime,

      endDate,

      endTime,

      passengers: intent.passengers ?? undefined,

    });

    // 6. Jika unit sudah dipilih, validasi terhadap hasil backend

    if (intent.selectedVehicle) {

      const selected = availability.available.find(

        (unit: any) =>

          normalize(unit.name) === normalize(intent.selectedVehicle)

      );

      if (!selected) {

        const conflict = availability.unavailable.find(

          (unit: any) =>

            normalize(unit.name) === normalize(intent.selectedVehicle)

        );

        return Response.json({

          success: true,

          reply: conflict

            ? `Maaf, ${conflict.name} tidak dapat dipilih untuk jadwal tersebut. Alasan: ${conflict.reason} Silakan pilih unit lain dari daftar yang tersedia.`

            : "Saya belum dapat mencocokkan pilihan unit itu dengan hasil pengecekan sistem. Silakan pilih kembali nama kendaraan dari daftar rekomendasi.",

        });

      }

      // 7. Kumpulkan detail yang masih belum diisi

      if (!intent.destination) {

        return Response.json({

          success: true,

          draft_status: "collecting_details",

          selected_vehicle: selected.name,

          reply: `Baik, kamu memilih ${selected.name}, dengan driver ${selected.driver}. Untuk menyiapkan draft pengajuan, tujuan perjalanannya ke mana?`,

        });

      }

      if (!intent.purpose) {

        return Response.json({

          success: true,

          draft_status: "collecting_details",

          selected_vehicle: selected.name,

          reply: `Tujuan perjalanan: ${intent.destination}. Apa keperluan atau perihal perjalanan tersebut?`,

        });

      }

      // 7B. Kumpulkan identitas dan data wajib pengajuan AI.
      // NIPP/email tidak dianggap terverifikasi; admin tetap memeriksa manual.
      const applicantFields: Array<[string, string | null | undefined]> = [
        ["nama lengkap", intent.applicantName],
        ["NIPP", intent.nipp],
        ["email pemohon", intent.email],
        ["nomor WhatsApp", intent.whatsapp],
        ["unit kerja/departemen", intent.department],
        ["tipe perjalanan", intent.tripType],
        ["tipe peminjaman (Dengan Driver atau Lepas Kunci)", intent.loanType],
      ];

      const missingApplicantFields = applicantFields
        .filter(([, value]) => !String(value || "").trim())
        .map(([label]) => label);

      if (String(intent.tripType || "").trim().toUpperCase() === "URGENT" &&
          !String(intent.urgentReason || "").trim()) {
        missingApplicantFields.push("alasan URGENT");
      }

      if (/perjalanan dinas|\bdinas\b/i.test(String(intent.tripType || "")) &&
          !String(intent.sppdReference || "").trim()) {
        missingApplicantFields.push("dasar/nomor SPPD");
      }

      if (missingApplicantFields.length) {
        return Response.json({
          success: true,
          draft_status: "collecting_applicant_details",
          selected_vehicle: selected.name,
          reply: [
            `Unit ${selected.name} tersedia untuk jadwal yang dipilih.`,
            `Untuk melanjutkan pengajuan, kirim data berikut dalam satu pesan: ${missingApplicantFields.join(", ")}.`,
            "Gunakan pilihan tipe perjalanan yang berlaku di P-CAR. Jika URGENT, sertakan alasannya.",
            "Untuk perjalanan dinas, sertakan dasar/nomor SPPD.",
            "Jika ada, sertakan daftar tamu, hotel, dan link HTTPS file SPPD.",
            "Data identitas akan diperiksa admin sebelum pengajuan diteruskan ke approval."
          ].join("\n\n"),
        });
      }

      // 8. Semua detail cukup: tampilkan draft, jangan menulis ke Sheet

      const draft = {

        unit: selected.name,

        driver: selected.driver,

        startDate: intent.startDate,

        startTime: intent.startTime,

        endDate,

        endTime,

        passengers: intent.passengers,

        destination: intent.destination,

        purpose: intent.purpose,

        applicantName: intent.applicantName,

        nipp: intent.nipp,

        email: intent.email,

        whatsapp: intent.whatsapp,

        department: intent.department,

        tripType: intent.tripType,

        loanType: intent.loanType,

        guestList: intent.guestList,

        hotel: intent.hotel,

        urgentReason: intent.urgentReason,

        sppdReference: intent.sppdReference,

        sppdFileUrl: intent.sppdFileUrl,

        assumedOneHour,

        status: "DRAFT",

      };

      if (!intent.bookingConfirmation) {

        return Response.json({

          success: true,

          draft_status: "awaiting_confirmation",

          bookingDraft: draft,

          reply: `Berikut draft pengajuan kamu:

Unit: ${selected.name}
Driver: ${selected.driver}
Berangkat: ${intent.startDate} pukul ${intent.startTime}
Kembali: ${endDate} pukul ${endTime}
Penumpang: ${intent.passengers ?? "Belum disebutkan"}
Tujuan: ${intent.destination}
Keperluan: ${intent.purpose}
Nama: ${intent.applicantName}
NIPP: ${intent.nipp}
Email: ${intent.email}
WhatsApp: ${intent.whatsapp}
Unit kerja: ${intent.department}
Tipe perjalanan: ${intent.tripType}
Tipe peminjaman: ${intent.loanType}
Daftar tamu: ${intent.guestList || "Belum diisi"}
Hotel: ${intent.hotel || "-"}
Dasar SPPD: ${intent.sppdReference || "-"}
Lampiran SPPD: ${intent.sppdFileUrl || "Belum disertakan; admin perlu memeriksa jika diwajibkan"}
${String(intent.tripType || "").toUpperCase() === "URGENT" ? `Alasan URGENT: ${intent.urgentReason || "-"}
` : ""}
${
            assumedOneHour
              ? "Catatan: jam kembali menggunakan asumsi satu jam setelah keberangkatan. "
              : ""
          }Setelah konfirmasi, pengajuan akan masuk ke status PENDING VERIFIKASI, bukan langsung disetujui. Balas KONFIRMASI hanya jika semua detail sudah benar.`,

        });

      }

      // 9. Konfirmasi: kirim melalui gateway server Vercel ke GAS.
      // Konfirmasi tidak menyetujui booking; status awal tetap PENDING VERIFIKASI.
      const submitUrl = new URL("/api/submit-request", request.url);
      const combinedDestination = `${intent.destination} | Keperluan: ${intent.purpose}`;
      const passengerAndGuestList = [
        intent.passengers ? `Jumlah penumpang: ${intent.passengers}` : "",
        intent.guestList ? `Daftar tamu: ${intent.guestList}` : "",
      ].filter(Boolean).join("; ");

      const submitPayload = {
        data: {
          name: intent.applicantName,
          nipp: intent.nipp,
          email: intent.email,
          whatsapp: intent.whatsapp,
          department: intent.department,
          startDateTime: `${intent.startDate}T${intent.startTime}`,
          endDateTime: `${endDate}T${endTime}`,
          vehicle: selected.name,
          destination: combinedDestination,
          purpose: intent.purpose,
          passengers: intent.passengers,
          tripType: intent.tripType,
          loanType: intent.loanType,
          guestList: passengerAndGuestList,
          hotel: intent.hotel || "",
          urgentReason: intent.urgentReason || "",
          sppdReference: intent.sppdReference || "",
          sppdFileUrl: intent.sppdFileUrl || "",
        },
      };

      let submitResponse: Response;
      try {
        submitResponse = await fetch(submitUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pcar-internal-secret": process.env.PCAR_GAS_API_SECRET || "",
          },
          body: JSON.stringify(submitPayload),
          cache: "no-store",
        });
      } catch (submitError) {
        console.error("P-CAR submit gateway error:", submitError);
        return Response.json({
          success: false,
          draft_status: "submission_failed",
          bookingDraft: draft,
          reply: "Draft sudah dikonfirmasi, tetapi koneksi ke layanan pengajuan gagal. Belum ada pengajuan yang tercatat. Silakan coba lagi sebentar lagi.",
        }, { status: 502 });
      }

      let submitResult: any;
      try {
        submitResult = await submitResponse.json();
      } catch {
        submitResult = null;
      }

      if (!submitResponse.ok || !submitResult?.ok) {
        console.error("P-CAR submit rejected:", submitResponse.status, submitResult?.error);
        return Response.json({
          success: false,
          draft_status: "submission_failed",
          bookingDraft: draft,
          reply: submitResult?.error || "Pengajuan belum berhasil dicatat. Tidak ada booking resmi yang dibuat; silakan coba kembali atau hubungi admin.",
        }, { status: 502 });
      }

      return Response.json({
        success: true,
        draft_status: "pending_verification",
        bookingDraft: { ...draft, status: submitResult.status || "PENDING VERIFIKASI" },
        submission: {
          row: submitResult.row,
          duplicate: submitResult.duplicate ?? false,
        },
        reply: submitResult.duplicate
          ? `Pengajuan yang sama sudah tercatat di P-CAR (referensi baris ${submitResult.row}). Statusnya masih PENDING VERIFIKASI. Admin harus memeriksa identitas dan kelengkapan sebelum pengajuan diteruskan ke approval.`
          : `Pengajuan berhasil dicatat di P-CAR dengan referensi ${submitResult.row}. Status: PENDING VERIFIKASI. Ini belum berarti mobil disetujui atau terpesan. Admin akan memeriksa identitas dan kelengkapan terlebih dahulu sebelum meneruskannya ke alur approval.`,
      });

    }

    // 9. Belum memilih unit: jelaskan hasil pencarian backend

    const answerPrompt = `

${FLEET_SYSTEM_RULES}

Hasil pengecekan backend adalah sumber kebenaran.

Jangan menambahkan kendaraan yang tidak tercantum di available.

Jangan menyebut booking sudah dibuat.

Permintaan:

${JSON.stringify({

  startDate: intent.startDate,

  startTime: intent.startTime,

  endDate,

  endTime,

  passengers: intent.passengers,

  assumedOneHour,

})}

Hasil backend:

${JSON.stringify(availability, null, 2)}

Pertanyaan user:

${message.trim()}

Jawab dalam Bahasa Indonesia yang ramah.

Berikan maksimal 5 rekomendasi unit yang tersedia.

Sebutkan driver dan kapasitas hanya jika diketahui.

Jelaskan jika jam kembali merupakan asumsi.

Minta user memilih unit untuk melanjutkan pembuatan draft.

`;

    const answerResult = await model.generateContent(answerPrompt);

    return Response.json({

      success: true,

      reply: answerResult.response.text(),

      checked: {

        startDate: intent.startDate,

        startTime: intent.startTime,

        endDate,

        endTime,

        passengers: intent.passengers,

        assumedOneHour,

      },

      updated_at: fleetData.updated_at,

    });

  } catch (error) {

    console.error("P-CAR CHAT ERROR:", error);

    return Response.json(

      {

        success: false,

        error:

          error instanceof Error

            ? error.message

            : String(error),

      },

      { status: 500 }

    );

  }

}
