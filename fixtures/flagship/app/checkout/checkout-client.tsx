'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import StepBar from '../components/StepBar';
import FareHoldBanner from '../components/FareHoldBanner';
import SliderCaptcha from '../components/SliderCaptcha';
import { formatDateLong, money } from '../components/format';
import { useBooking } from '../state/BookingContext';

export default function CheckoutClient() {
  const router = useRouter();
  const { hydrated, flight, fareCode, seatId, seatFee, completeBooking, api } = useBooking();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [holderName, setHolderName] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && (!flight || !fareCode || !seatId)) router.replace('/');
  }, [hydrated, flight, fareCode, seatId, router]);

  if (!hydrated || !flight || !fareCode || !seatId) return null;

  const fare = flight.fares.find((f) => f.code === fareCode);
  const total = (fare?.price ?? 0) + seatFee;
  const formComplete =
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    cardNumber.trim() &&
    expiry.trim() &&
    cvv.trim() &&
    captchaVerified;

  const pay = async () => {
    if (!formComplete || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const booked = await api<{ b: string; a: number }>('/api/book', {
        f: flight.id,
        c: fareCode,
        s: seatId,
        px: { fn: firstName, ln: lastName, em: email },
      });
      const paid = await api<{ p: string }>('/api/pay', {
        b: booked.b,
        cn: cardNumber,
        ex: expiry,
        cv: cvv,
        nm: holderName,
      });
      completeBooking(paid.p, { firstName, lastName, email });
      router.push('/confirmation');
    } catch {
      setErrorMessage(
        'Your payment could not be processed. Please check your details and try again.',
      );
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-line bg-white px-4 py-3 text-[14px] transition-colors focus:border-navy';

  return (
    <div className="flex min-h-screen flex-col">
      <FareHoldBanner />
      <StepBar current={2} />

      <div className="mx-auto w-full max-w-6xl flex-1 px-6 pt-4 pb-6">
        <div className="mb-6 text-[22px] font-semibold text-ink">Passenger &amp; payment</div>

        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-line bg-white p-6">
              <div className="mb-4 text-[15px] font-semibold text-ink">Passenger details</div>
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className={inputClass}
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
                <input
                  className={`${inputClass} md:col-span-2`}
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-white p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-[15px] font-semibold text-ink">Payment</div>
                <div className="flex items-center gap-1.5">
                  {['#1a1f71', '#eb001b', '#0079be'].map((color) => (
                    <div key={color} className="h-5 w-8 rounded" style={{ background: color }} />
                  ))}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className={`${inputClass} md:col-span-2`}
                  placeholder="Card number"
                  inputMode="numeric"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="MM/YY"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="CVC"
                  inputMode="numeric"
                  value={cvv}
                  onChange={(e) => setCvv(e.target.value)}
                />
                <input
                  className={`${inputClass} md:col-span-2`}
                  placeholder="Name on card"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                />
              </div>
              <div className="mt-5">
                <SliderCaptcha
                  verified={captchaVerified}
                  onVerified={() => setCaptchaVerified(true)}
                />
              </div>
              {errorMessage && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
                  {errorMessage}
                </div>
              )}
            </div>
          </div>

          <div className="h-fit rounded-2xl border border-line bg-white p-6">
            <div className="mb-4 text-[15px] font-semibold text-ink">Trip summary</div>
            <div className="mb-4 rounded-xl bg-cloud p-4">
              <div className="text-[13px] font-semibold text-ink">
                {flight.origin} → {flight.destination}
              </div>
              <div className="mt-0.5 text-[12.5px] text-mist">
                {formatDateLong(flight.date)} · {flight.departureTime} · {flight.flightNumber}
              </div>
              <div className="mt-0.5 text-[12.5px] text-mist">
                {fare?.name} · Seat {seatId}
              </div>
            </div>
            <div className="space-y-2.5 text-[13.5px]">
              <div className="flex justify-between">
                <div className="text-mist">Fare</div>
                <div className="font-medium text-ink">{money(fare?.price ?? 0)}</div>
              </div>
              <div className="flex justify-between">
                <div className="text-mist">Seat {seatId}</div>
                <div className="font-medium text-ink">{seatFee ? money(seatFee) : 'Included'}</div>
              </div>
              <div className="flex justify-between">
                <div className="text-mist">Taxes &amp; fees</div>
                <div className="font-medium text-ink">Included</div>
              </div>
              <div className="my-3 h-px bg-line" />
              <div className="flex justify-between text-[15px]">
                <div className="font-semibold text-ink">Total</div>
                <div className="font-semibold text-navy">{money(total)}</div>
              </div>
            </div>
            <div
              className={`mt-6 rounded-lg py-3 text-center text-[14px] font-semibold transition-colors select-none ${
                formComplete && !submitting
                  ? 'cursor-pointer bg-gold text-navy-deep hover:bg-gold-bright'
                  : 'cursor-default bg-line text-mist'
              }`}
              onClick={pay}
            >
              {submitting ? 'Processing…' : `Pay ${money(total)}`}
            </div>
            <div className="mt-3 text-center text-[11.5px] leading-relaxed text-mist">
              By paying you agree to our fare conditions and conditions of carriage.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
