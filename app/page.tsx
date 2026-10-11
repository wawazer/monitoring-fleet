
"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

type Schedule = {
  date: string;
  start: string;
  end: string;
  status: "IN_USE" | "BOOKED" | string;
  label?: string;
};

type Unit = {
  name: string;
  driver: string;
  master_status?: string;
  km_terakhir?: number | null;
  schedule: Schedule[];
};

type Data = {
  updated_at: string;
  days: string[];
  units: Unit[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Page() {
  const [data, setData] = useState<Data | null>(null);
  const [dashboardError, setDashboardError] = useState("");

  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Halo! Saya P-CAR Fleet Assistant. Saya bisa membantu mencari kendaraan berdasarkan tanggal, jam, jumlah penumpang, dan jadwal armada. Ada yang ingin kamu cari?",
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Ambil data dashboard dari API yang sudah berjalan
  const fetchData = async () => {
    try {
      const res = await fetch("/api/dashboard", {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const json: Data = await res.json();

      setData(json);
      setDashboardError("");
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setDashboardError("Gagal memuat data dashboard.");
    }
  };

  // Auto-refresh setiap 5 menit
  useEffect(() => {
    void fetchData();

    const interval = setInterval(() => {
      void fetchData();
    }, 300000);

    return () => clearInterval(interval);
  }, []);

  // Gulir ke pesan terbaru
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, chatOpen]);

  const getColor = (status: string) => {
    if (status === "IN_USE") {
      return "bg-red-400 text-black";
    }

    if (status === "BOOKED") {
      return "bg-yellow-300 text-black";
    }

    return "bg-green-200 text-black";
  };

  const getMasterStatusColor = (status?: string) => {
    const normalized = (status || "").trim().toLowerCase();

    if (normalized === "available") {
      return "bg-green-200 text-black";
    }

    if (
      normalized === "in use" ||
      normalized === "in_use" ||
      normalized === "maintenance" ||
      normalized === "rusak"
    ) {
      return "bg-red-300 text-black";
    }

    if (normalized === "booked") {
      return "bg-yellow-300 text-black";
    }

    return "bg-gray-300 text-black";
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = chatInput.trim();

    if (!message || isSending) return;

    setChatInput("");
    setChatError("");

    setMessages((prev) => [
      ...prev,
      { role: "user", content: message },
    ]);

    setIsSending(true);

    try {
      const history = messages.slice(-12).map((item) => ({
  role: item.role,
  content: item.content,
}));

const response = await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message,
    history,
  }),
});

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || result.message || `HTTP ${response.status}`
        );
      }

      const reply =
        typeof result.reply === "string" && result.reply.trim()
          ? result.reply
          : "Maaf, saya belum menerima jawaban dari AI.";

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply },
      ]);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      console.error("AI chat error:", error);
      setChatError(errorMessage);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Maaf, saya belum bisa memproses pertanyaan tersebut. Silakan coba lagi sebentar.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const suggestions = [
    "Mobil apa yang tersedia besok?",
    "Cari mobil untuk 8 orang.",
    "Cek jadwal kendaraan tanggal 14 Oktober.",
  ];

  if (!data) {
    return (
      <div className="min-h-screen bg-black p-4 text-white">
        <h1 className="text-xl font-bold">P-Car Monitoring</h1>
        <p className="mt-2 text-sm text-gray-400">
          {dashboardError || "Memuat data dashboard..."}
        </p>
        {dashboardError && (
          <button
            onClick={() => void fetchData()}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white"
          >
            Coba lagi
          </button>
        )}
      </div>
    );
  }

  // Gunakan hari pertama dari GAS agar sesuai dengan tanggal lokal sistem
  const today = data.days[0];

  return (
    <div className="min-h-screen bg-black p-4 text-white">
      {/* HEADER */}
      <div className="mb-4">
        <h1 className="text-xl font-bold">P-Car Monitoring</h1>

        <p className="text-sm text-gray-400">
          Last Update: {data.updated_at}
        </p>

        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded bg-green-200 px-2 text-black">
            Available
          </span>

          <span className="rounded bg-yellow-300 px-2 text-black">
            Booked
          </span>

          <span className="rounded bg-red-400 px-2 text-black">
            In Use
          </span>
        </div>

        {dashboardError && (
          <p className="mt-2 text-sm text-amber-300">
            {dashboardError} Data yang tampil mungkin belum terbaru.
          </p>
        )}
      </div>

      {/* DASHBOARD TABLE */}
      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[220px] border border-gray-700 bg-gray-900 p-2 text-left">
                Unit / Driver
              </th>

              {data.days.map((day) => (
                <th
                  key={day}
                  className={`min-w-[140px] border border-gray-700 p-2 ${
                    day === today ? "bg-blue-900" : "bg-gray-800"
                  }`}
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {data.units.map((unit, idx) => (
              <tr key={`${unit.name}-${idx}`}>
                <td className="sticky left-0 z-10 border border-gray-700 bg-gray-900 p-2">
                  <div className="font-semibold">{unit.name}</div>

                  <div className="text-xs text-gray-400">
                    Driver: {unit.driver || "-"}
                  </div>

                  {unit.master_status && (
                    <span
                      className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${getMasterStatusColor(
                        unit.master_status
                      )}`}
                    >
                      {unit.master_status}
                    </span>
                  )}
                </td>

                {data.days.map((day) => {
                  const schedules = unit.schedule.filter(
                    (schedule) => schedule.date === day
                  );

                  return (
                    <td
                      key={day}
                      className="min-w-[140px] border border-gray-700 p-1 align-top"
                    >
                      {schedules.length === 0 ? (
                        unit.master_status?.trim().toLowerCase() ===
                        "available" ? (
                          <div className="rounded bg-green-200 p-1 text-center text-sm text-black">
                            AVAILABLE
                          </div>
                        ) : (
                          <div className="rounded bg-gray-300 p-1 text-center text-sm text-black">
                            {unit.master_status || "STATUS UNKNOWN"}
                          </div>
                        )
                      ) : (
                        schedules.map((schedule, i) => {
                          const isFullDay =
                            schedule.start === "00:00" &&
                            schedule.end === "23:59";

                          return (
                            <div
                              key={`${schedule.date}-${schedule.start}-${i}`}
                              className={`mb-1 rounded border border-black/20 px-2 py-1 text-xs ${getColor(
                                schedule.status
                              )}`}
                            >
                              <div className="font-semibold">
                                {schedule.label || schedule.status}
                              </div>

                              <div>
                                {isFullDay
                                  ? "FULL DAY"
                                  : `${schedule.start} - ${schedule.end}`}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FLOATING AI BUTTON */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-semibold text-white shadow-xl transition hover:bg-emerald-500"
          aria-label="Buka AI Fleet Assistant"
        >
          <span className="text-xl">✦</span>
          <span>AI PCAR fleet Assistant</span>
        </button>
      )}

      {/* CHAT WINDOW */}
      {chatOpen && (
        <section
          className="fixed bottom-4 right-4 z-50 flex h-[min(72vh,620px)] max-h-[calc(100vh-2rem)] min-h-[400px] w-[calc(100vw-2rem)] max-w-[410px] flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-950 text-white shadow-2xl"
          aria-label="AI Fleet Assistant Chat"
        >
          {/* CHAT HEADER */}
          <div className="flex items-center justify-between border-b border-gray-700 bg-gray-900 p-4">
            <div>
              <h2 className="font-bold">✦ AI Fleet Assistant</h2>
              <p className="text-xs text-gray-400">
                Asisten kendaraan P-CAR
              </p>
            </div>

            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="rounded-lg px-3 py-1 text-xl text-gray-300 hover:bg-gray-700"
              aria-label="Tutup chat"
            >
              ×
            </button>
          </div>

          {/* QUICK PROMPTS */}
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 border-b border-gray-800 p-3">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setChatInput(suggestion)}
                  className="rounded-full border border-gray-700 px-3 py-2 text-left text-xs text-gray-200 hover:border-emerald-500 hover:bg-gray-900"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {/* MESSAGES */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message, idx) => (
              <div
                key={`${message.role}-${idx}`}
                className={`flex ${
                  message.role === "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "rounded-br-sm bg-emerald-700 text-white"
                      : "rounded-bl-sm bg-gray-800 text-gray-100"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {isSending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-gray-800 px-3 py-2 text-sm text-gray-300">
                  Sedang mengecek data armada...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ERROR INFO */}
          {chatError && (
            <div className="border-t border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-200">
              Detail error: {chatError}
            </div>
          )}

          {/* INPUT */}
          <form
            onSubmit={handleSend}
            className="flex items-end gap-2 border-t border-gray-700 bg-gray-900 p-3"
          >
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder="Tanya ketersediaan kendaraan..."
              disabled={isSending}
              className="max-h-28 min-h-11 flex-1 resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-emerald-500 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={isSending || !chatInput.trim()}
              className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Kirim pesan"
            >
              {isSending ? "..." : "Kirim"}
            </button>
          </form>

          <div className="bg-gray-900 px-3 pb-3 text-center text-[10px] text-gray-500">
            Rekomendasi AI perlu divalidasi sistem sebelum booking.
          </div>
        </section>
      )}
    </div>
  );
}
