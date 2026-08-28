export interface CardDetails {
  cardNumber: string;
  expiry: string; // MM/YY
  cvv: string;
  holderName: string;
}

export interface ChargeResult {
  success: boolean;
  paymentRef?: string;
  declineCode?: string;
}

// Mock processor: the standard test card succeeds, everything else declines.
const TEST_CARD = '4242424242424242';

export function chargeCard(card: CardDetails, amount: number): ChargeResult {
  const digits = card.cardNumber.replace(/\D/g, '');
  if (digits.length < 15 || !/^\d{2}\/\d{2}$/.test(card.expiry) || !/^\d{3,4}$/.test(card.cvv)) {
    return { success: false, declineCode: 'invalid_details' };
  }
  if (amount <= 0) {
    return { success: false, declineCode: 'invalid_amount' };
  }
  if (digits !== TEST_CARD) {
    return { success: false, declineCode: 'card_declined' };
  }
  return {
    success: true,
    paymentRef: `ch_${Math.random().toString(36).slice(2, 12)}`,
  };
}
