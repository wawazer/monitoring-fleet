
import { GoogleGenerativeAI } from "@google/generative-ai";

import { checkFleetAvailability } from "@/lib/fleetHelper";

import { FLEET_SYSTEM_RULES } from "@/lib/fleetRules";


function getGasDashboardUrl_(): string {
  const configuredUrl = process.env.PCAR_GAS_WEBAPP_URL;

  if (!configuredUrl) {
    throw new Error("PCAR_GAS_WEBAPP_URL belum dikonfigurasi di Vercel.");
  }

  const url = new URL(configuredUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("action", "dashboard_json");

  url.searchParams.set("days", "30");
  return url.toString();
}

type ChatMessage = {

  role: "user" | "assistant";

  content: string;

};

type FleetAvailableUnit = {
  name: string;
  driver?: string;
  [key: string]: unknown;
};

type FleetUnavailableUnit = FleetAvailableUnit & {
  reason?: string;
};

type FleetAvailabilityResult = {
  available: FleetAvailableUnit[];
  unavailable: FleetUnavailableUnit[];
  [key: string]: unknown;
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

/** Mengenali permintaan agar AI memilihkan kendaraan dari daftar sebelumnya. */
function isAutoPickRequest(message: string): boolean {
  const normalized = String(message || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /\bpilih\s*kan\b/.test(normalized) ||
    /\bpilihin\b/.test(normalized) ||
    /\bpilih (salah satu|yang cocok|yang sesuai|yang terbaik|yang tersedia)\b/.test(normalized) ||
    /\bcarikan (yang|yg) (ada|cocok|sesuai|tersedia)\b/.test(normalized) ||
    /\bterserah\b.*\b(pilih|pilihin|pilihkan)\b/.test(normalized) ||
    /\b(kamu|anda)\s+(saja\s+)?pilih\b/.test(normalized);
}

function isExplicitNewFleetSearch(message: string): boolean {
  const normalized = String(message || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /\b(mobil apa|cari mobil|carikan mobil|cari kendaraan|carikan kendaraan|cek jadwal|cek kendaraan|kendaraan apa yang tersedia|mobil apa yang tersedia|jadwal kendaraan)\b/.test(normalized);
}

function hasRecentVehicleRecommendations(history: ChatMessage[]): boolean {
  const lastAssistant = [...history].reverse().find((item) => item.role === "assistant");
  return Boolean(lastAssistant &&
    /berikut kendaraan yang tersedia|kendaraan yang tersedia untuk jadwal|pilih nomor atau tuliskan nama kendaraan/i.test(lastAssistant.content));
}

/** Rekonstruksi pilihan unit dari percakapan tanpa bergantung sepenuhnya pada Gemini. */
function inferSelectedVehicleFromHistory(history: ChatMessage[]): string | null {
  let selectedVehicle: string | null = null;
  let latestRecommendations: string[] = [];

  const parseRecommendationLines = (content: string): string[] => {
    if (!/berikut kendaraan yang tersedia|kendaraan yang tersedia untuk jadwal|pilih nomor atau tuliskan nama kendaraan/i.test(content)) return [];
    return content.split(/\r?\n/)
      .map((line) => {
        const entry = line.match(/^\s*\d{1,2}\.\s*(.+)$/);
        if (!entry) return null;
        return entry[1]
          .replace(/\*+/g, "")
          .split(/\s+[—–-]\s+driver\b/i)[0]
          .split(/\s*\(driver\s*:/i)[0]
          .trim();
      })
      .filter((name): name is string => Boolean(name));
  };

  for (const item of history) {
    if (item.role === "user") {
      if (isExplicitNewFleetSearch(item.content)) {
        selectedVehicle = null;
        latestRecommendations = [];
        continue;
      }
      const choice = item.content.toLowerCase().match(/\b(?:nomor|no\.?|pilihan|pilih)\s*(?:ke[- ]?)?(\d{1,2})\b/);
      if (choice && latestRecommendations.length) {
        const index = Number(choice[1]) - 1;
        if (index >= 0 && index < latestRecommendations.length) selectedVehicle = latestRecommendations[index];
      }
      continue;
    }

    const listed = parseRecommendationLines(item.content);
    if (listed.length) latestRecommendations = listed;

    const patterns = [
      /(?:kamu memilih|saya pilihkan|saya memilihkan|saya memilih|saya sudah memilih)\s+(.+?)(?=,\s*(?:dengan\s+driver|driver)\b|\.\s|\n|$)/i,
      /(?:^|\n)\s*(?:unit|kendaraan yang dipilih)\s*:\s*(.+?)\s*(?:\n|$)/i,
      /\bunit\s+(.+?)\s+tersedia untuk jadwal\b/i,
    ];
    for (const pattern of patterns) {
      const match = item.content.match(pattern);
      if (!match?.[1]) continue;
      const candidate = match[1]
        .replace(/\*+/g, "")
        .split(/\s+[—–-]\s+driver\b/i)[0]
        .split(/\s*\(driver\s*:/i)[0]
        .trim();
      if (candidate && !/^(ini|tersebut|yang dipilih)$/i.test(candidate)) selectedVehicle = candidate;
      break;
    }
  }
  return selectedVehicle;
}

function inferReplyToPromptFromHistory(
  history: ChatMessage[],
  field: "destination" | "purpose"
): string | null {
  const promptPattern = field === "destination"
    ? /tujuan perjalanan(?:nya)? ke mana/i
    : /apa keperluan(?: atau perihal)? perjalanan|keperluan atau perihal perjalanan/i;
  let waitingForAnswer = false;
  let answer: string | null = null;

  for (const item of history) {
    if (item.role === "assistant") {
      if (promptPattern.test(item.content)) waitingForAnswer = true;
      continue;
    }
    if (waitingForAnswer) {
      const candidate = item.content.trim();
      if (candidate) answer = candidate;
      waitingForAnswer = false;
    }
  }
  return answer;
}

function isContinuingDraftFromHistory(history: ChatMessage[], currentMessage: string): boolean {
  if (isExplicitNewFleetSearch(currentMessage)) return false;
  const lastAssistant = [...history].reverse().find(item => item.role === "assistant");
  const draftPromptPattern = /tujuan perjalanan(?:nya)? ke mana|apa keperluan(?: atau perihal)? perjalanan|kirim data berikut|data identitas akan diperiksa|untuk melanjutkan pengajuan|berikut draft pengajuan|balas konfirmasi/i;
  if (lastAssistant && draftPromptPattern.test(lastAssistant.content)) return true;

  const recent = history.slice(-12);
  const hadDraftPrompt = recent.some(item => item.role === "assistant" && draftPromptPattern.test(item.content));
  const hadSelectedVehicle = Boolean(inferSelectedVehicleFromHistory(history));
  return hadDraftPrompt && hadSelectedVehicle;
}

/** Jika user memilih "nomor N", cocokkan dengan daftar rekomendasi terakhir. */
function inferVehicleFromNumberChoice(
  history: ChatMessage[],
  message: string
): string | null {
  const match = String(message || "").toLowerCase().match(/\b(?:nomor|no\.?|pilihan|pilih)\s*(?:ke[- ]?)?(\d{1,2})\b/);
  if (!match) return null;
  const wanted = Number(match[1]);

  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.role !== "assistant" || !/kendaraan yang tersedia|pilih nomor atau tuliskan nama kendaraan/i.test(item.content)) continue;
    for (const line of item.content.split(/\r?\n/)) {
      const entry = line.match(/^\s*(\d{1,2})\.\s*(.+)$/);
      if (!entry || Number(entry[1]) !== wanted) continue;
      const vehicle = entry[2]
        .replace(/\*+/g, "")
        .split(/\s+[—–-]\s+driver\b/i)[0]
        .split(/\s*\(driver\s*:/i)[0]
        .trim();
      return vehicle || null;
    }
  }
  return null;
}

function inferVehicleNamedInMessage(
  message: string,
  units: FleetAvailableUnit[]
): string | null {
  const text = normalize(message);
  const matches = units
    .filter(unit => unit.name && text.includes(normalize(unit.name)))
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0]?.name || null;
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

    // Ambil data fleet terbaru dari GAS.
    // Baca sebagai teks dulu agar HTTP error atau respons HTML bisa didiagnosis.
    const gasDashboardUrl = getGasDashboardUrl_();
    const fleetResponse = await fetch(gasDashboardUrl, {
      cache: "no-store",
      redirect: "follow",
    });

    const fleetResponseText = await fleetResponse.text();
    const fleetContentType = fleetResponse.headers.get("content-type") || "unknown";

    if (!fleetResponse.ok) {
      console.error("[P-CAR] GAS dashboard HTTP error", {
        status: fleetResponse.status,
        statusText: fleetResponse.statusText,
        finalUrl: fleetResponse.url,
        contentType: fleetContentType,
        responsePreview: fleetResponseText.slice(0, 500),
      });

      throw new Error(
        `Gagal mengambil data fleet dari GAS (HTTP ${fleetResponse.status} ${fleetResponse.statusText}). Periksa deployment dan akses Web App GAS.`
      );
    }

    let fleetData: any;
    try {
      fleetData = JSON.parse(fleetResponseText);
    } catch (parseError) {
      console.error("[P-CAR] GAS dashboard bukan JSON", {
        status: fleetResponse.status,
        finalUrl: fleetResponse.url,
        contentType: fleetContentType,
        responsePreview: fleetResponseText.slice(0, 500),
      });

      throw new Error(
        `GAS tidak mengembalikan JSON yang valid (HTTP ${fleetResponse.status}, content-type ${fleetContentType}). Buka URL dashboard_json langsung untuk memeriksa akses Web App.`
      );
    }

    if (

      !Array.isArray(fleetData.units) ||

      !Array.isArray(fleetData.days) ||

      fleetData.days.length === 0

    ) {

      throw new Error("Struktur data fleet tidak valid.");

    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel(
      {
        model: "gemini-3.5-flash-lite",
        generationConfig: { maxOutputTokens: 512 },
      },
      { timeout: 45000 }
    );

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
- Jika pesan user terbaru hanya meminta AI memilihkan (misalnya "pilih kan",
  "pilihkan", atau "pilih yang cocok") tanpa menyebut nomor/nama unit,
  biarkan selectedVehicle null. Backend akan memilih unit yang tersedia.
- Jika sebelumnya AI sudah menyatakan unit yang dipilih, pertahankan unit itu
  selama percakapan sedang mengumpulkan tujuan, keperluan, atau identitas pemohon.
  Jangan kembali ke daftar rekomendasi hanya karena pesan terbaru berisi data pemohon.
- Pertahankan tujuan dan keperluan yang sudah dijawab. Jangan menafsirkan kembali
  jawaban tujuan/keperluan sebagai permintaan pencarian armada baru.

- wajib menanyakan tanggal dan kembali unit

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

    // Fallback deterministik: jangan biarkan Gemini melupakan kendaraan yang
    // sudah dipilih ketika user menjawab tujuan, keperluan, atau data pemohon.
    const continuingDraft = isContinuingDraftFromHistory(history, message);
    const numberedChoice = inferVehicleFromNumberChoice(history, message);
    const typedVehicle = inferVehicleNamedInMessage(message, fleetData.units);
    const previousSelectedVehicle = continuingDraft ? inferSelectedVehicleFromHistory(history) : null;
    const autoPickNow = isAutoPickRequest(message) && hasRecentVehicleRecommendations(history);

    if (autoPickNow) {
      // Permintaan pilihkan baru harus memakai hasil ketersediaan terbaru dari backend.
      intent.selectedVehicle = null;
    } else if (continuingDraft && previousSelectedVehicle && !numberedChoice && !typedVehicle) {
      // Pada lanjutan draft, pilihan historis lebih tepercaya daripada tebakan model.
      intent.selectedVehicle = previousSelectedVehicle;
    } else if (!intent.selectedVehicle) {
      intent.selectedVehicle = numberedChoice || typedVehicle || previousSelectedVehicle;
    }

    if (continuingDraft) {
      const lastAssistant = [...history].reverse().find(item => item.role === "assistant");
      if (!intent.destination && lastAssistant && /tujuan perjalanan(?:nya)? ke mana/i.test(lastAssistant.content)) {
        intent.destination = message.trim();
      } else if (!intent.destination) {
        intent.destination = inferReplyToPromptFromHistory(history, "destination");
      }
      if (!intent.purpose && lastAssistant && /apa keperluan(?: atau perihal)? perjalanan|keperluan atau perihal perjalanan/i.test(lastAssistant.content)) {
        intent.purpose = message.trim();
      } else if (!intent.purpose) {
        intent.purpose = inferReplyToPromptFromHistory(history, "purpose");
      }
      intent.isFleetRequest = true;
    }


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


    const availability = checkFleetAvailability(fleetData, {

      startDate: intent.startDate,

      startTime: intent.startTime,

      endDate,

      endTime,

      passengers: intent.passengers ?? undefined,

    }) as unknown as FleetAvailabilityResult;

    // Kalau user menulis "pilih kan" setelah menerima daftar kendaraan,
    // pilih unit pertama yang masih tersedia berdasarkan hasil backend terbaru.
    // Pengecekan ketersediaan/kapasitas tetap berasal dari checkFleetAvailability.
    const autoPickRequested =
      !intent.selectedVehicle &&
      isAutoPickRequest(message) &&
      hasRecentVehicleRecommendations(history);
    const effectiveSelectedVehicle = intent.selectedVehicle ||
      (autoPickRequested ? availability.available[0]?.name || null : null);
    const assistantSelectedVehicle = Boolean(
      autoPickRequested && effectiveSelectedVehicle
    );

    // 6. Jika unit dipilih oleh user atau diminta agar AI memilihkan, validasi ulang.
    if (effectiveSelectedVehicle) {

      const selected = availability.available.find(

        (unit: any) =>

          normalize(unit.name) === normalize(effectiveSelectedVehicle)

      );

      if (!selected) {

        const conflict = availability.unavailable.find(

          (unit: any) =>

            normalize(unit.name) === normalize(effectiveSelectedVehicle)

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

          reply: assistantSelectedVehicle
            ? `Sesuai permintaanmu, saya pilihkan ${selected.name}, dengan driver ${selected.driver || "belum tercatat"}. Unit ini tersedia untuk jadwal ${intent.startDate} pukul ${intent.startTime} sampai ${endDate} pukul ${endTime}. Untuk menyiapkan draft pengajuan, tujuan perjalanannya ke mana?`
            : `Baik, kamu memilih ${selected.name}, dengan driver ${selected.driver || "belum tercatat"}. Untuk menyiapkan draft pengajuan, tujuan perjalanannya ke mana?`,

        });

      }

      if (!intent.purpose) {

        return Response.json({

          success: true,

          draft_status: "collecting_details",

          selected_vehicle: selected.name,

          reply: assistantSelectedVehicle
            ? `Saya sudah memilihkan ${selected.name} untuk jadwal tersebut. Tujuan perjalanan: ${intent.destination}. Apa keperluan atau perihal perjalanan tersebut?`
            : `Tujuan perjalanan: ${intent.destination}. Apa keperluan atau perihal perjalanan tersebut?`,

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
            assistantSelectedVehicle
              ? `Sesuai permintaanmu, saya memilih ${selected.name}. Unit ini tersedia untuk jadwal yang dipilih.`
              : `Unit ${selected.name} tersedia untuk jadwal yang dipilih.`,
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

    // 9. Belum memilih unit: jawab langsung dari hasil backend.
    // Menghindari panggilan Gemini kedua agar pencarian kendaraan lebih cepat.
    // const recommendations = availability.available.slice(0, 10);
        const recommendations = availability.available;
    const checkedText = `Jadwal yang dicek: ${intent.startDate} ${intent.startTime}–${endDate} ${endTime}.`;
    const durationNote = assumedOneHour
      ? "Catatan: jam kembali diasumsikan satu jam setelah berangkat."
      : "";

    let availabilityReply: string;
    if (recommendations.length === 0) {
      availabilityReply = [
        `Maaf, tidak ada kendaraan yang tersedia untuk jadwal tersebut.`,
        checkedText,
        durationNote,
        "Coba ubah jam atau tanggal, atau periksa kembali jumlah penumpang."
      ].filter(Boolean).join("\n\n");
    } else {
      const recommendationText = recommendations.map((unit, index) =>
        `${index + 1}. ${unit.name}${unit.driver ? ` — driver ${unit.driver}` : ""}`
      ).join("\n");

      availabilityReply = [
        `Berikut kendaraan yang tersedia untuk jadwal kamu:`,
        checkedText,
        recommendationText,
        durationNote,
        "Pilih nomor atau tuliskan nama kendaraan untuk melanjutkan draft pengajuan."
      ].filter(Boolean).join("\n\n");
    }

    return Response.json({
      success: true,
      reply: availabilityReply,
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
