# Privacy-friendly analytics contract

Bhabhi Thulla does not currently load an analytics provider or send analytics events. This document is the allowlist to use if anonymous product analytics are introduced later.

## Collection rules

- Analytics must be optional, documented, and disabled until a provider has been deliberately configured.
- Never collect a player name, room code, reconnect token, socket ID, IP address, card ID, card hand, chat text, or invite URL.
- Never place identifiers in page URLs or analytics properties.
- Do not use advertising identifiers, third-party cookies, session replay, fingerprinting, or cross-site tracking.
- Prefer aggregate counts. If a temporary anonymous session identifier is needed for funnel analysis, generate it in memory and discard it when the tab closes.
- Bucket durations and player counts before sending them. Do not send exact timestamps or exact match histories.
- Apply retention limits at the analytics provider and document them in the public privacy notice.

Every event may contain only these common properties:

| Property | Example | Notes |
| --- | --- | --- |
| `schema_version` | `1` | Integer event-contract version |
| `app_version` | `1.1.0` | Public release version |
| `language` | `en`, `roman`, `ur` | Selected interface language |
| `display_mode` | `browser`, `standalone` | Whether the installed PWA is being used |
| `viewport` | `phone`, `tablet`, `desktop` | Coarse category, never exact dimensions |

## Allowed events

| Event | Trigger | Additional allowed properties |
| --- | --- | --- |
| `landing_viewed` | Landing page becomes visible | None |
| `tutorial_started` | Interactive tutorial opens | `source`: `landing`, `rules`, or `first_room` |
| `tutorial_completed` | Final tutorial step completes | None |
| `room_create_succeeded` | A private room is created | `mode`: `friends` or `practice` |
| `room_join_succeeded` | A private room is joined | `invite_used`: boolean |
| `minimum_players_reached` | A room first reaches three seats | `player_bucket`: `3-4`, `5-6`, or `7-8` |
| `match_started` | Cards are dealt | `player_bucket`, `turn_seconds`, `bots_present`: boolean |
| `match_completed` | A round result becomes final | `player_bucket`, `bots_present`, `duration_bucket`: `<5m`, `5-10m`, `10-20m`, or `20m+` |
| `rematch_started` | The same table begins another round | `round_bucket`: `2`, `3-4`, or `5+` |
| `reconnect_succeeded` | A seat is restored after a connection loss | `delay_bucket`: `<10s`, `10-30s`, or `30-60s` |
| `reconnect_failed` | Reconnect grace expires | `delay_bucket`: `30-60s` or `60s+` |
| `pwa_installed` | Browser confirms installation | None |

Room codes and player identifiers are deliberately absent. A product question that cannot be answered with this event allowlist requires a privacy review before changing the contract.
