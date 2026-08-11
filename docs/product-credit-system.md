# Pay-Per-Bid Credit System

## Product Overview
The Pay-Per-Bid Credit System allows vendors to purchase "Bid Credits" to submit proposals for high-value RFPs on the Omnitender platform. 
A single bid credit is valued at **$10**.

## Pricing Tiers
We offer several pricing tiers for vendors to purchase Bid Credits in bulk, providing a discount for larger purchases:

*   **1 Credit:** $10
*   **5 Credits:** $45 (10% discount)
*   **20 Credits:** $160 (20% discount)
*   **100 Credits:** $700 (30% discount)

## Checkout Integration Specifications
The credit purchasing system will integrate with both Stripe (for fiat currency) and Coinbase Commerce (for cryptocurrency).

### Stripe Integration
*   Use Stripe Checkout for a hosted payment page experience.
*   Create Stripe Products and Prices for each tier.
*   Implement webhooks (`checkout.session.completed`) to securely grant credits upon successful payment.

### Coinbase Integration
*   Use Coinbase Commerce API to create charges.
*   Support major cryptocurrencies (BTC, ETH, USDC).
*   Implement webhooks (`charge:confirmed`) to grant credits upon successful network confirmation.

## Database Schema Requirements
We need to track user credit balances and a history of transactions (purchases and usage).

### `User` Table (Updates)
*   Add column: `credit_balance` (Integer, default 0)

### `CreditTransaction` Table (New)
*   `id` (Primary Key, UUID)
*   `user_id` (Foreign Key -> User.id)
*   `amount` (Integer, positive for purchase, negative for usage)
*   `type` (Enum: 'purchase', 'bid_submission', 'refund', 'admin_adjustment')
*   `reference_id` (String, nullable. e.g., Stripe Payment Intent ID or RFP ID)
*   `created_at` (Timestamp)

## Marketing Copy & Page Outline

### Page Outline: "Get Bid Credits"
1.  **Hero Section:** High-impact headline emphasizing the value of bidding on premium RFPs.
2.  **How It Works:** 3 simple steps (Buy Credits -> Find RFP -> Submit Bid).
3.  **Pricing Cards:** Clear presentation of the 3 main tiers (5, 20, 100) highlighting the savings.
4.  **FAQ:** Address common questions (e.g., "Do credits expire?", "Can I get a refund?").

### Marketing Copy Drafts
*   **Headline:** Unlock Premium Opportunities with Bid Credits.
*   **Subheadline:** Don't miss out on high-value contracts. Stock up on Bid Credits today and submit winning proposals.
*   **Value Proposition:** "Pay only for what you pitch. No monthly subscriptions, just pure opportunity."
*   **Call to Action (CTA):** "Buy Credits Now" / "Stock Up & Save"
