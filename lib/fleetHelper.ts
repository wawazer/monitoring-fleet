
import { vehicleCapacity } from "@/lib/vehicleCapacity";

type Schedule = {
  date: string;
  start: string;
  end: string;
  status: string;
  label?: string;
  request_row?: number;
};

type FleetUnit = {
  name: string;
  driver: string;
  master_status?: string;
  km_terakhir?: number | null;
  schedule?: Schedule[];
};

type FleetData = {
  updated_at?: string;
  units: FleetUnit[];
};

type AvailabilityRequest = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  passengers?: number;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/[✅🔑⚠️]\s*/g, "")
    .trim()
    .toLowerCase();
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;

  const [hour, minute] = value.split(":").map(Number);

  return hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59;
}

export function checkFleetAvailability(
  fleetData: FleetData,
  request: AvailabilityRequest
) {
  const {
    startDate,
    startTime,
    endDate,
    endTime,
    passengers,
  } = request;

  if (
    !isValidDate(startDate) ||
    !isValidDate(endDate) ||
    !isValidTime(startTime) ||
    !isValidTime(endTime)
  ) {
    throw new Error("Format tanggal atau jam tidak valid.");
  }

  const requestedStart = `${startDate}T${startTime}`;
  const requestedEnd = `${endDate}T${endTime}`;

  if (requestedStart >= requestedEnd) {
    throw new Error("Waktu kembali harus setelah waktu berangkat.");
  }

  if (
    passengers !== undefined &&
    (!Number.isInteger(passengers) || passengers < 1)
  ) {
    throw new Error("Jumlah penumpang harus berupa bilangan bulat positif.");
  }

  const available: object[] = [];
  const unavailable: object[] = [];

  for (const unit of fleetData.units ?? []) {
    const status = normalize(unit.master_status);

    const capacityKey = Object.keys(vehicleCapacity).find(
      key => normalize(unit.name).includes(normalize(key))
    );

    const capacity = capacityKey
      ? vehicleCapacity[capacityKey]
      : null;

    const schedule = unit.schedule ?? [];

    // Jadwal yang tumpang tindih membuat unit tidak tersedia.
    const conflicts = schedule.filter(item => {
      const scheduleStart = `${item.date}T${item.start}`;

      // Jadwal sampai 23:59 diperlakukan hingga akhir hari.
      const scheduleEnd = item.end === "23:59"
        ? `${item.date}T24:00`
        : `${item.date}T${item.end}`;

      return (
        requestedStart < scheduleEnd &&
        requestedEnd > scheduleStart
      );
    });

    let reason = "";

    if (status !== "available") {
      reason = `Status master kendaraan: ${
        unit.master_status || "Tidak diketahui"
      }`;
    } else if (conflicts.length > 0) {
      reason = "Ada jadwal yang berbenturan.";
    } else if (
      passengers !== undefined &&
      (capacity === null || capacity < passengers)
    ) {
      reason = capacity === null
        ? "Kapasitas kendaraan belum terverifikasi."
        : `Kapasitas ${capacity} orang tidak mencukupi ${passengers} penumpang.`;
    }

    const result = {
      name: unit.name,
      driver: unit.driver,
      master_status: unit.master_status ?? "Tidak diketahui",
      capacity,
      km_terakhir: unit.km_terakhir ?? null,
      conflicts: conflicts.map(item => ({
        date: item.date,
        start: item.start,
        end: item.end,
        status: item.status,
        request_row: item.request_row,
      })),
    };

    if (reason) {
      unavailable.push({
        ...result,
        reason,
      });
    } else {
      available.push(result);
    }
  }

  return {
    request,
    updated_at: fleetData.updated_at ?? null,
    available,
    unavailable,
    available_count: available.length,
    unavailable_count: unavailable.length,
  };
}
