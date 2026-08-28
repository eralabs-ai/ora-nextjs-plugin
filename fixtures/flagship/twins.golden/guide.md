---
title: "Booking guide"
canonical_url: https://flagship-fixture.example.com/guide
last_updated: <last_updated>
generated-by: "@ora-ai/ax"
---

# Booking guide

How to search, hold, and pay for an Ora Air flight — the same flow whether you are a person in a
browser or an agent driving the MCP tools.

## Search

Start from the [homepage](/) or call the public MCP server's `search_flights` tool with an origin,
a destination, and an ISO date. Results include a flight id, fare classes, and one-way prices.

## Choose a seat

Every fare class permits seat selection before payment. Seat maps list each cabin's rows, the
seats still open, and any extra-legroom fee. Agents fetch the same data with `get_seat_map` on the
gated MCP server.

## Book and pay

Booking creates a pending reservation with a `bookingId` and the total amount due. Payment
confirms it and returns a PNR. This is a demo environment: use the test card `4242 4242 4242 4242`
— any other number declines.

## When things go wrong

- An unknown flight id means the fare expired; search again.
- A declined payment leaves the booking pending; retry with the test card.
- Seats are held only after payment, so a taken seat means re-selecting from the current map.
