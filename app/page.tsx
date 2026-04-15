"use client";

import { useEffect, useState } from "react";

type Schedule = {
  date: string;
  start: string;
  end: string;
  status: "IN_USE" | "BOOKED";
};

type Unit = {
  name: string;
  schedule: Schedule[];
};

type Data = {
  updated_at: string;
  days: string[];
  units: Unit[];
};

const API_URL =
  "https://script.google.com/macros/s/AKfycbxICLEfVFaYQdZydstk4kwmZHipDNvTSxB2xj1DwATX9wHAmCCW8FZQf9SiwxiEgtlOnQ/exec?action=dashboard_json";

export default function Page() {
  const [data, setData] = useState<Data | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(API_URL);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  // 🔄 AUTO REFRESH 5 MENIT
  useEffect(() => {
    fetchData();

    const interval = setInterval(() => {
      fetchData();
    }, 300000); // 5 menit

    return () => clearInterval(interval);
  }, []);

  if (!data) return <div className="p-4 text-white">Loading...</div>;

  const today = new Date().toISOString().slice(0, 10);

  const getColor = (status: string) => {
    if (status === "IN_USE") return "bg-red-400 text-black";
    if (status === "BOOKED") return "bg-yellow-300 text-black";
    return "bg-green-200 text-black";
  };

  return (
    <div className="p-4 bg-black min-h-screen text-white">
      {/* HEADER */}
      <div className="mb-4">
        <h1 className="text-xl font-bold">🚗 Fleet Monitoring</h1>
        <p className="text-sm text-gray-400">
          Last Update: {data.updated_at}
        </p>

        {/* LEGEND */}
        <div className="flex gap-4 mt-2 text-sm">
          <span className="bg-green-200 text-black px-2 rounded">
            Available
          </span>
          <span className="bg-yellow-300 text-black px-2 rounded">
            Booked
          </span>
          <span className="bg-red-400 text-black px-2 rounded">
            In Use
          </span>
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-auto border border-gray-700">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-gray-900 border border-gray-700 p-2 z-10">
                Unit
              </th>

              {data.days.map((day) => (
                <th
                  key={day}
                  className={`border border-gray-700 p-2 ${
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
              <tr key={idx}>
                {/* UNIT NAME */}
                <td className="sticky left-0 bg-gray-900 border border-gray-700 p-2 font-semibold z-10">
                  {unit.name}
                </td>

                {/* DAYS */}
                {data.days.map((day) => {
                  const schedules = unit.schedule.filter(
                    (s) => s.date === day
                  );

                  return (
                    <td
                      key={day}
                      className="border border-gray-700 p-1 align-top min-w-[140px]"
                    >
                      {schedules.length === 0 ? (
                        <div className="bg-green-200 text-black text-center rounded p-1 text-sm">
                          AVAILABLE
                        </div>
                      ) : (
                        schedules.map((s, i) => {
                          const isFullDay =
                            s.start === "00:00" && s.end === "23:59";

                          return (
                            <div
                              key={i}
                              className={`${getColor(
                                s.status
                              )} rounded px-2 py-1 mb-1 text-xs border border-black/20`}
                            >
                              {isFullDay
                                ? "FULL DAY"
                                : `${s.start} - ${s.end}`}
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
    </div>
  );
}