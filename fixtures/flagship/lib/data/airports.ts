export interface Airport {
  code: string;
  city: string;
  name: string;
  country: string;
}

export const AIRPORTS: Airport[] = [
  {
    code: 'JFK',
    city: 'New York',
    name: 'John F. Kennedy International',
    country: 'United States',
  },
  { code: 'LAX', city: 'Los Angeles', name: 'Los Angeles International', country: 'United States' },
  {
    code: 'SFO',
    city: 'San Francisco',
    name: 'San Francisco International',
    country: 'United States',
  },
  { code: 'MIA', city: 'Miami', name: 'Miami International', country: 'United States' },
  { code: 'ORD', city: 'Chicago', name: "O'Hare International", country: 'United States' },
  { code: 'SEA', city: 'Seattle', name: 'Seattle-Tacoma International', country: 'United States' },
  { code: 'LHR', city: 'London', name: 'Heathrow', country: 'United Kingdom' },
  { code: 'CDG', city: 'Paris', name: 'Charles de Gaulle', country: 'France' },
  { code: 'TLV', city: 'Tel Aviv', name: 'Ben Gurion', country: 'Israel' },
  { code: 'NRT', city: 'Tokyo', name: 'Narita International', country: 'Japan' },
  { code: 'SIN', city: 'Singapore', name: 'Changi', country: 'Singapore' },
  { code: 'DXB', city: 'Dubai', name: 'Dubai International', country: 'United Arab Emirates' },
];

export function getAirport(code: string): Airport | undefined {
  return AIRPORTS.find((a) => a.code === code.toUpperCase());
}
