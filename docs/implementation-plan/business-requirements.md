# CompetitorPulse business requirements

## Purpose

A product manager needs to know what changed across tracked competitors since the last time they checked. Manually revisiting listings takes time, and a current listing alone cannot show what it said before. CompetitorPulse keeps that history so the product manager can identify a change, inspect the evidence, and decide whether it warrants a response.

## Changes worth tracking

Flag changes to the advertised price, listing wording, or availability. Any wording edit to the title, tagline, or description counts, even when the meaning stays the same.

| What changed? | Why track it? |
| --- | --- |
| The listing shows a new price, free plan, or billing term. | Buyers see a different cost or commitment. |
| The listing starts or stops mentioning a feature, benefit, or limit. | The competitor has changed what it tells buyers they will get. |
| The title, tagline, or description changes the advertised name, intended audience, or main selling point. | The competitor is presenting the product differently to potential buyers. |
| A previously visible listing disappears from the source or returns after an absence. | Buyers’ ability to find the product on that source has changed. |

## How to interpret observations

- The first complete listing establishes a baseline. Compare each later complete listing with the last complete one, even if intervening checks failed.
- Keep every check in the timeline, including unchanged listings, incomplete responses, timeouts, and source errors. A timeout leaves availability unknown. A missing field in a partial response leaves its previous value unconfirmed.
- Ignore presentation differences such as whitespace, HTML escaping, and equivalent price formats. Changing viewer counts and request timestamps also fall outside the tracked business changes.
- Describe what the listing supports. “The listing now mentions AI reminders” is supported by the two observations. A claim about the feature’s launch date would require additional evidence.

## What the product manager can see

The user can add or remove a competitor by ID and see which tracked competitors changed in the past 24 hours. Each competitor has a newest-first timeline covering at least 90 days, with the time and outcome of each check. Meaningful changes get a short, plain-English summary when available. If a summary is pending, fails, or exceeds the daily budget, the observation remains visible with the reason. [Assignment brief](../../assignment/instructions.md)
