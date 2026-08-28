import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';

import { getSeatMap } from '@/lib/data/seatmaps';
import { createBooking, getBooking, confirmBooking } from '@/lib/services/booking';
import { chargeCard } from '@/lib/services/payment';

// Gated MCP server — seat maps, booking, and payment. Auth is required so ax advertises
// this as a gated surface (withMcpAuth) while /api/public/mcp stays public. Agents authenticate
// via OAuth: a 401 here points at the RFC 9728 metadata (/.well-known/oauth-protected-resource).
// The verifier is a deterministic stub (one fixed test token) — no fixture test drives a real
// OAuth handshake; what's under test is the static withMcpAuth detection and the discovery chain.
const handler = createMcpHandler(
  (server) => {
    server.tool(
      'get_seat_map',
      'Get the seat map (cabins, seats, fees) for a specific flight.',
      {
        flightId: z.string().describe('Flight id from search_flights results'),
      },
      async ({ flightId }) => {
        const seatMap = getSeatMap(flightId);
        if (!seatMap) {
          return { content: [{ type: 'text', text: 'Unknown flight id.' }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(seatMap) }] };
      },
    );

    server.tool(
      'book_flight',
      'Create a pending booking for a flight, fare class, and seat. Returns a bookingId and amount.',
      {
        flightId: z.string().describe('Flight id from search_flights'),
        fareClass: z.string().describe("Fare class code, e.g. 'Y', 'W', 'J'"),
        seatId: z.string().describe("Seat id from get_seat_map, e.g. '14C'"),
        firstName: z.string().describe('Passenger first name'),
        lastName: z.string().describe('Passenger last name'),
        email: z.string().email().describe('Passenger email'),
      },
      async ({ flightId, fareClass, seatId, firstName, lastName, email }) => {
        const result = createBooking({
          flightId,
          fareClass,
          seatId,
          passenger: { firstName, lastName, email },
        });
        if ('error' in result) {
          return {
            content: [{ type: 'text', text: `Could not book: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookingId: result.bookingId, amount: result.amount }),
            },
          ],
        };
      },
    );

    server.tool(
      'pay_booking',
      'Pay for a pending booking and confirm it. Use test card 4242 4242 4242 4242; other cards decline.',
      {
        bookingId: z.string().describe('bookingId from book_flight'),
        cardNumber: z.string().describe('Card number (test: 4242 4242 4242 4242)'),
        expiry: z.string().describe('Card expiry MM/YY'),
        cvv: z.string().describe('Card CVV'),
        holderName: z.string().optional().describe('Cardholder name'),
      },
      async ({ bookingId, cardNumber, expiry, cvv, holderName }) => {
        const booking = getBooking(bookingId);
        if (!booking || booking.status !== 'pending') {
          return {
            content: [{ type: 'text', text: 'Unknown or non-pending booking.' }],
            isError: true,
          };
        }
        const charge = chargeCard(
          { cardNumber, expiry, cvv, holderName: holderName ?? '' },
          booking.amount,
        );
        if (!charge.success) {
          return { content: [{ type: 'text', text: 'Payment declined.' }], isError: true };
        }
        const confirmed = confirmBooking(booking.bookingId, charge.paymentRef!);
        if ('error' in confirmed) {
          return {
            content: [{ type: 'text', text: `Could not confirm: ${confirmed.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ pnr: confirmed.pnr, bookingId: confirmed.bookingId }),
            },
          ],
        };
      },
    );
  },
  {
    serverInfo: { name: 'ora-air-booking', version: '0.1.0' },
  },
  {
    basePath: '/api',
    maxDuration: 60,
  },
);

const gatedHandler = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (bearerToken !== 'flagship-test-token') return undefined;
    return { token: bearerToken, clientId: 'flagship-fixture', scopes: ['email', 'profile'] };
  },
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource' },
);

export { gatedHandler as GET, gatedHandler as POST, gatedHandler as DELETE };
