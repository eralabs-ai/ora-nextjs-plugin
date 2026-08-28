import { getAirport } from './airports';

export type AircraftType = 'A320neo' | 'B787-9';

export interface FareOption {
  classCode: string; // internal fare basis, e.g. Y1, Y2, J1
  className: string;
  price: number; // USD
  perks: string[];
}

export interface Flight {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  departureTime: string; // HH:MM local
  arrivalTime: string; // HH:MM local
  durationMinutes: number;
  aircraft: AircraftType;
  fares: FareOption[];
}

// Deterministic PRNG so the same route + date always yields the same flights.
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rough great-circle-ish duration table keyed by unordered pair; fallback derived from seed.
const ROUTE_MINUTES: Record<string, number> = {
  'JFK-LAX': 360,
  'JFK-SFO': 380,
  'JFK-MIA': 190,
  'JFK-ORD': 150,
  'JFK-SEA': 370,
  'JFK-LHR': 415,
  'JFK-CDG': 440,
  'JFK-TLV': 630,
  'JFK-NRT': 840,
  'JFK-SIN': 1130,
  'JFK-DXB': 750,
  'LAX-SFO': 85,
  'LAX-MIA': 290,
  'LAX-ORD': 245,
  'LAX-SEA': 165,
  'LAX-LHR': 630,
  'LAX-CDG': 650,
  'LAX-TLV': 900,
  'LAX-NRT': 690,
  'LAX-SIN': 1050,
  'LAX-DXB': 960,
  'SFO-ORD': 255,
  'SFO-SEA': 130,
  'SFO-MIA': 320,
  'SFO-LHR': 620,
  'SFO-NRT': 660,
  'LHR-CDG': 80,
  'LHR-TLV': 290,
  'LHR-DXB': 410,
  'CDG-TLV': 270,
  'TLV-DXB': 200,
  'SIN-NRT': 420,
  'SIN-DXB': 450,
  'NRT-DXB': 660,
  'ORD-MIA': 185,
  'ORD-SEA': 250,
  'SEA-MIA': 340,
  'MIA-LHR': 520,
  'ORD-LHR': 470,
  'SEA-NRT': 630,
  'MIA-CDG': 540,
};

function routeMinutes(origin: string, destination: string, rand: () => number): number {
  const key = [origin, destination].sort().join('-');
  return ROUTE_MINUTES[key] ?? 120 + Math.floor(rand() * 600);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function minutesToClock(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function generateFlights(origin: string, destination: string, date: string): Flight[] {
  const o = getAirport(origin);
  const d = getAirport(destination);
  if (!o || !d || o.code === d.code) return [];

  const seed = hashString(`${o.code}|${d.code}|${date}`);
  const rand = mulberry32(seed);
  const count = 5 + Math.floor(rand() * 4); // 5-8 flights
  const duration = routeMinutes(o.code, d.code, rand);
  const longHaul = duration > 420;

  const flights: Flight[] = [];
  for (let i = 0; i < count; i++) {
    const depMinutes = 355 + Math.floor(i * (1080 / count) + rand() * 60); // spread 06:00-23:00
    const jitteredDuration = duration + Math.floor(rand() * 30) - 15;
    const aircraft: AircraftType = longHaul || rand() > 0.7 ? 'B787-9' : 'A320neo';
    const flightNumber = `MR ${100 + Math.floor(rand() * 880)}`;
    const basePrice = Math.round((60 + duration * 0.55) * (0.85 + rand() * 0.5));

    flights.push({
      id: `${o.code}${d.code}${date.replaceAll('-', '')}${pad(i)}`,
      flightNumber,
      origin: o.code,
      destination: d.code,
      date,
      departureTime: minutesToClock(depMinutes),
      arrivalTime: minutesToClock(depMinutes + jitteredDuration),
      durationMinutes: jitteredDuration,
      aircraft,
      fares: [
        {
          classCode: 'Y1',
          className: 'Economy Light',
          price: basePrice,
          perks: ['Carry-on bag', 'Seat assigned at check-in'],
        },
        {
          classCode: 'Y2',
          className: 'Economy Flex',
          price: Math.round(basePrice * 1.45),
          perks: ['Carry-on + checked bag', 'Free seat selection', 'Changes allowed'],
        },
        {
          classCode: 'J1',
          className: 'Business',
          price: Math.round(basePrice * 3.4),
          perks: ['Lounge access', 'Lie-flat seat', 'Priority boarding', '2 checked bags'],
        },
      ],
    });
  }
  return flights.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

export function getFlight(flightId: string): Flight | undefined {
  // Flight ids encode origin/destination/date: e.g. JFKLAX2026072100
  const match = /^([A-Z]{3})([A-Z]{3})(\d{8})(\d{2})$/.exec(flightId);
  if (!match) return undefined;
  const [, origin, destination, rawDate] = match;
  const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
  return generateFlights(origin, destination, date).find((f) => f.id === flightId);
}
