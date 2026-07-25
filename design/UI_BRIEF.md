# UI design brief

Paste everything below the line into Claude to generate design directions.

---

# Design a rewards platform UI — 3 to 5 distinct directions

## What this is

A GPT ("get-paid-to") rewards site, India-first. Users complete third-party
surveys and offers, earn points, and cash out to UPI. We are an aggregator —
survey walls and offer walls supply the inventory, they pay us per completed
action, and we pass a share to the user.

Direct competitors: GrabPoints, HeyCash, Swagbucks, Rakuten. Look at what they
do, then do better — most of them look like 2014 affiliate dashboards.

## Who uses it

Indian users, overwhelmingly on mobile Android, often mid-range devices on
patchy connections. They open the app several times a day in short bursts —
between classes, on a commute, waiting for something. They are earning real but
small amounts: a good day is ₹50–100. They are price-sensitive, they compare
notes with friends and in Telegram groups, and they have almost certainly been
burned by a site that did not pay.

**Design mobile-first. Desktop is secondary.**

## The central design problem

**This category has a trust problem, and the UI is where it is won or lost.**

Search any competitor and you will find users asking "is this a scam." The
mechanics that cause that suspicion are unavoidable and built into how the
industry works:

- Points are credited, then sometimes **taken back days later** when the
  advertiser reverses the conversion.
- Newly earned points are **not immediately withdrawable** — they sit in a hold
  window while the network can still claw them back.
- Some completions get **held for fraud review** before crediting.
- Most survey attempts end in **disqualification** ("screenout") and pay a
  couple of points instead of a couple of hundred.
- Payouts go through **manual approval**, so the money does not move instantly.

A design that hides these makes them feel like theft when the user discovers
them. A design that dumps them all on screen is overwhelming and reads as
bureaucratic. **The core challenge is making an honest, slightly awkward
financial reality feel trustworthy rather than suspicious.**

Solve that, and everything else is detail.

## Screens to design

Design all of these for each direction:

1. **Earn (home)** — the offer feed plus survey-wall entry points, and a daily
   bonus/streak. Where users land.
2. **Wallet** — balance, its breakdown, and transaction history.
3. **Cash out** — request a payout, plus a history of past payouts and their
   states.
4. **Refer** — referral link, what it pays, list of friends referred.

Optional if you have room: support/missing-points claim, signup.

## Real data to design with

Do not use lorem ipsum. Use these actual values.

**Balance for a moderately active user**

- Total: **14,009 points ≈ ₹1,400.90**
- Available to cash out: **7,932 points (₹793.20)**
- On hold (clearing): **6,077 points (₹607.70)**
- Under review: **0** — but design the state, another user has 6,077 here
- Minimum cash-out: **5,000 points (₹500)**
- Conversion: **10 points = ₹1**

**Offers in the feed** (title, points, category, estimated time)

- Credit card application — approved · **6,077 pts** · signup · ~20 min
  · "Approval required, not just application. Long confirmation window."
- Streaming trial — 7 days · **1,878 pts** · signup · ~10 min
  · "Card or UPI mandate required. Cancels within 7 days are reversed."
- Meesho — first order · **1,160 pts** · purchase · ~15 min
  · "New customers only. Reversed if the order is cancelled or returned."
- Amazon Pay — complete a UPI transaction · **524 pts** · signup · ~8 min
- Dream11 — register and join a contest · **773 pts** · signup · ~10 min
- Ludo Star — reach level 5 · **342 pts** · game · ~45 min
- Grocery app — install and open · **99 pts** · app install · ~3 min

**Survey wall** — not an offer, a doorway. One entry point, no fixed reward,
outcome unknown until they try. Copy currently reads: "Answer a few questions
to see which surveys you qualify for. Partial credit is paid if you are
screened out."

**Transaction history rows**

| Activity | Source | Status | Points |
|---|---|---|---|
| Offer completed | Simulated Offer Wall | Clearing | +6,077 |
| Survey completed | Simulated Survey Wall | Cleared | +631 |
| Survey screenout | Simulated Survey Wall | Cleared | **+1** |
| Reversed by network — *trial cancelled within 7 days* | Simulated Offer Wall | Cleared | **−1,878** |
| Daily bonus — streak day 4 | — | Cleared | +25 |
| Referral commission | — | Cleared | +195 |
| Referral bonus — referral qualified | — | Cleared | +500 |
| Cash out | — | Cleared | −5,000 |

**Payout states** — `requested`, `under review`, `approved`, `sending`,
`paid`, `failed`, `cancelled`. Example rows: ₹500 paid via UPI to
`d•••@okhdfcbank`; ₹600 under review; ₹500 failed — "recipient account is
closed".

**Referrals** — 500 points when a friend first earns, then 10% of everything
they earn afterwards, paid by us and never deducted from them. Referred users
show as `p•••@gmail.com` with a state of "Earning" or "Not yet earning".

**Daily bonus** — claim once a day, grows with streak length: 10 points on day
1, +5 per consecutive day, capping at day 7.

## The hard states — design these explicitly, do not skip them

Most designs fail here. Each of these must have an obvious treatment:

1. **A reversal.** The user opens the app and has fewer points than yesterday
   because a network clawed one back. How do they find out? How do you explain
   it so they stay?
2. **A 1-point screenout.** They spent four minutes and got ₹0.10. How does
   that not read as an insult?
3. **Points on hold.** 6,077 points they can see but cannot spend yet. Why is
   this reassuring rather than suspicious?
4. **Under fraud review.** Points earned, not credited, no timeline promised.
   How do you say this without accusing them of anything?
5. **Below the minimum.** They have 2,000 of the 5,000 points needed. What does
   the cash-out screen show?
6. **A failed payout.** Money did not arrive, their UPI ID was wrong. Recovery
   path?
7. **A brand-new empty account.** Zero points, zero history, no referrals.
   Every screen has to work on day zero.

## Constraints

- **Mobile-first.** 360–430px is the primary canvas.
- **Indian currency formatting.** ₹1,400.90 and lakh grouping (₹1,40,000, not
  ₹140,000). Get this right; the audience notices instantly.
- **Points are large numbers, rupees are small.** 14,009 points is ₹1,400.90.
  Decide which one leads and be consistent.
- **Fast on cheap hardware.** No heavy animation, no huge images.
- **Accessible.** Real contrast ratios; do not rely on colour alone to
  distinguish "cleared" from "clearing" from "under review".
- Assume Tailwind CSS and React. No specific brand yet — propose one.

## What I want back

**Three to five genuinely distinct directions.** Not one design in five colour
schemes. Each should represent a different answer to the trust problem and a
different bet about what makes someone open this app tomorrow.

Suggested axis to spread across — a spectrum from **"this is a game"** to
**"this is a wallet"**:

- The game end: streaks, progress, levels, celebration, points feel like score.
  Higher engagement, but risks feeling frivolous when real money is involved.
- The wallet end: financial clarity, statement-like history, rupees prominent,
  restraint. Feels trustworthy, but can be boring enough that nobody returns.
- Middle grounds, and any direction that reframes the problem entirely.

You do not have to use that axis if you find a better one, but the directions
must differ in **approach**, not just in styling.

For each direction give me:

1. **A name and a one-line thesis.** What is the bet?
2. **Who it wins.** Which user does this serve best, and who does it lose?
3. **The trust answer.** Specifically how it handles reversals and held points.
4. **Screens.** Earn, Wallet, Cash out, Refer — as a working mobile mockup.
5. **The trade-off.** What this direction is knowingly worse at.

Deliver each as a **self-contained interactive HTML artifact** at mobile
viewport width, with real data from above, all four screens navigable, and the
hard states visible (not just the happy path). Inline all CSS. Tab bar or
whatever navigation the direction calls for.

Then end with **a short recommendation**: which one you would ship and why,
including what you would steal from the runners-up.
