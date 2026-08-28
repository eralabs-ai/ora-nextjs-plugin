import { getFlight, type AircraftType } from './flights';

export interface Seat {
  id: string; // e.g. "12A"
  row: number;
  column: string;
  occupied: boolean;
  extraLegroom: boolean;
  fee: number; // USD, on top of fare
}

export interface CabinSection {
  name: string;
  fareClasses: string[]; // which fare classes may sit here
  columns: string[]; // includes "" for aisle gaps, e.g. ["A","B","C","","D","E","F"]
  rows: number[];
  seats: Seat[];
}

interface CabinLayout {
  name: string;
  fareClasses: string[];
  columns: string[];
  startRow: number;
  endRow: number;
  extraLegroomRows: number[];
  fee: (row: number, extraLegroom: boolean) => number;
}

const LAYOUTS: Record<AircraftType, CabinLayout[]> = {
  A320neo: [
    {
      name: 'Business',
      fareClasses: ['J1'],
      columns: ['A', 'C', '', 'D', 'F'],
      startRow: 1,
      endRow: 3,
      extraLegroomRows: [1],
      fee: () => 0,
    },
    {
      name: 'Economy',
      fareClasses: ['Y1', 'Y2'],
      columns: ['A', 'B', 'C', '', 'D', 'E', 'F'],
      startRow: 6,
      endRow: 28,
      extraLegroomRows: [6, 14],
      fee: (row, extra) => (extra ? 32 : row <= 12 ? 14 : 0),
    },
  ],
  'B787-9': [
    {
      name: 'Business',
      fareClasses: ['J1'],
      columns: ['A', '', 'D', 'E', '', 'K'],
      startRow: 1,
      endRow: 6,
      extraLegroomRows: [1],
      fee: () => 0,
    },
    {
      name: 'Economy',
      fareClasses: ['Y1', 'Y2'],
      columns: ['A', 'B', 'C', '', 'D', 'E', 'F', '', 'H', 'J', 'K'],
      startRow: 10,
      endRow: 38,
      extraLegroomRows: [10, 24],
      fee: (row, extra) => (extra ? 45 : row <= 16 ? 19 : 0),
    },
  ],
};

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

export function getSeatMap(
  flightId: string,
): { aircraft: AircraftType; cabins: CabinSection[] } | undefined {
  const flight = getFlight(flightId);
  if (!flight) return undefined;

  const rand = mulberry32(hashString(`seats|${flightId}`));
  const cabins: CabinSection[] = LAYOUTS[flight.aircraft].map((layout) => {
    const rows: number[] = [];
    const seats: Seat[] = [];
    for (let row = layout.startRow; row <= layout.endRow; row++) {
      rows.push(row);
      for (const column of layout.columns) {
        if (!column) continue;
        const extraLegroom = layout.extraLegroomRows.includes(row);
        seats.push({
          id: `${row}${column}`,
          row,
          column,
          occupied: rand() < 0.55,
          extraLegroom,
          fee: layout.fee(row, extraLegroom),
        });
      }
    }
    return {
      name: layout.name,
      fareClasses: layout.fareClasses,
      columns: layout.columns,
      rows,
      seats,
    };
  });

  return { aircraft: flight.aircraft, cabins };
}
