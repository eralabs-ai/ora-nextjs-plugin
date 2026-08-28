import { getFlight, type Flight } from '../data/flights';
import { getSeatMap } from '../data/seatmaps';

export interface Passenger {
  firstName: string;
  lastName: string;
  email: string;
}

export interface Booking {
  bookingId: string;
  pnr: string | null;
  status: 'pending' | 'confirmed';
  flight: Flight;
  fareClass: string;
  seatId: string;
  passenger: Passenger;
  amount: number; // USD total (fare + seat fee)
  paymentRef: string | null;
  createdAt: number;
}

// In-memory store; survives dev hot reloads via globalThis.
const globalStore = globalThis as unknown as { __mrBookings?: Map<string, Booking> };
const bookings: Map<string, Booking> = (globalStore.__mrBookings ??= new Map());

function randomId(prefix: string, length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return prefix + out;
}

export function createBooking(input: {
  flightId: string;
  fareClass: string;
  seatId: string;
  passenger: Passenger;
}): Booking | { error: string } {
  const flight = getFlight(input.flightId);
  if (!flight) return { error: 'FLIGHT_NOT_FOUND' };

  const fare = flight.fares.find((f) => f.classCode === input.fareClass);
  if (!fare) return { error: 'FARE_NOT_FOUND' };

  const seatMap = getSeatMap(input.flightId);
  const seat = seatMap?.cabins
    .filter((c) => c.fareClasses.includes(input.fareClass))
    .flatMap((c) => c.seats)
    .find((s) => s.id === input.seatId);
  if (!seat) return { error: 'SEAT_NOT_FOUND' };
  if (seat.occupied) return { error: 'SEAT_TAKEN' };

  const { firstName, lastName, email } = input.passenger;
  if (!firstName?.trim() || !lastName?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) {
    return { error: 'INVALID_PASSENGER' };
  }

  const booking: Booking = {
    bookingId: randomId('BK', 10),
    pnr: null,
    status: 'pending',
    flight,
    fareClass: input.fareClass,
    seatId: input.seatId,
    passenger: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() },
    amount: fare.price + seat.fee,
    paymentRef: null,
    createdAt: Date.now(),
  };
  bookings.set(booking.bookingId, booking);
  return booking;
}

export function confirmBooking(bookingId: string, paymentRef: string): Booking | { error: string } {
  const booking = bookings.get(bookingId);
  if (!booking) return { error: 'BOOKING_NOT_FOUND' };
  if (booking.status === 'confirmed') return booking;
  booking.status = 'confirmed';
  booking.paymentRef = paymentRef;
  booking.pnr = randomId('', 6);
  return booking;
}

export function getBooking(bookingId: string): Booking | undefined {
  return bookings.get(bookingId);
}
