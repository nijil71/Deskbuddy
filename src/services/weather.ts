// Weather via Open-Meteo (free, no API key). Only the city you type is sent.
export interface Weather { temp: number; code: number; isDay: boolean; kind: "rain" | "snow" | "sun" | "cloud" | "storm"; label: string; at: number; }

const LABELS: [number[], string, Weather["kind"]][] = [
  [[0], "Clear", "sun"], [[1], "Mostly clear", "sun"], [[2], "Partly cloudy", "cloud"], [[3], "Overcast", "cloud"],
  [[45, 48], "Foggy", "cloud"], [[51, 53, 55, 56, 57], "Drizzle", "rain"], [[61, 63, 65, 66, 67], "Rain", "rain"],
  [[71, 73, 75, 77], "Snow", "snow"], [[80, 81, 82], "Showers", "rain"], [[85, 86], "Snow showers", "snow"],
  [[95, 96, 99], "Thunderstorm", "storm"],
];

export async function geocode(city: string): Promise<{ name: string; lat: number; lon: number } | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`);
  const j = await r.json();
  const g = j?.results?.[0];
  return g ? { name: `${g.name}${g.country_code ? ", " + g.country_code : ""}`, lat: g.latitude, lon: g.longitude } : null;
}

export async function fetchWeather(lat: number, lon: number, unit: "c" | "f"): Promise<Weather | null> {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day${unit === "f" ? "&temperature_unit=fahrenheit" : ""}`;
    const j = await (await fetch(u)).json();
    const c = j.current;
    const hit = LABELS.find(([codes]) => codes.includes(c.weather_code)) ?? [[], "Cloudy", "cloud" as const];
    let kind = hit[2];
    if (kind === "sun" && !c.is_day) kind = "cloud";
    return { temp: Math.round(c.temperature_2m), code: c.weather_code, isDay: !!c.is_day, kind, label: hit[1], at: Date.now() };
  } catch { return null; }
}

export function weatherText(w: Weather, unit: "c" | "f") {
  const icon = { rain: "🌧️", snow: "❄️", sun: "☀️", cloud: "⛅", storm: "⛈️" }[w.kind];
  const tip = w.kind === "rain" || w.kind === "storm" ? " Take an umbrella!" : w.kind === "snow" ? " Bundle up!" : w.temp > (unit === "c" ? 30 : 86) ? " Stay hydrated!" : "";
  return `${icon} ${w.temp}°${unit.toUpperCase()} · ${w.label}.${tip}`;
}
