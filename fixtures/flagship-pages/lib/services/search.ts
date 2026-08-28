import { generateFlights, type Flight } from '../data/flights';
import { getAirport } from '../data/airports';

export interface SearchQuery {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  passengers: number;
}

export function searchFlights(query: SearchQuery): Flight[] | null {
  if (!getAirport(query.origin) || !getAirport(query.destination)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) return null;
  if (query.passengers < 1 || query.passengers > 9) return null;
  return generateFlights(query.origin, query.destination, query.date);
}
