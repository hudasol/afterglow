# Responsible use and data handling

AFTERGLOW follows the safe use guidance supplied with the Qloo hackathon kit.

## Principles

1. **Aggregate taste, not individuals.** Qloo results describe what groups of people tend to like. AFTERGLOW does not infer a person's identity, sensitive traits, health, finances, politics or eligibility for anything, and does not describe an affinity as a probability about a person.
2. **Minimal data to Qloo.** Only the city, the venue category, public taste names and phrases, and, when a distance limit is set, the original venue name are sent. Names, email addresses, device identifiers, account identifiers and location histories are never sent.
3. **Source on every fact.** The interface labels each value as Qloo, Simulated, You said, You checked or Calculated here, so a Qloo result is never confused with the product's own interpretation.
4. **No guessing.** When a name or phrase matches several entries, the person chooses. When a fact is unknown, the place is flagged for the person's check and never assumed to pass.
5. **No hidden action.** AFTERGLOW never books or contacts anyone. Every consequential step is the person's.
6. **Honest demo.** Demo mode uses an invented city and says so on every screen where it appears.

## Secrets

- The Qloo key lives only in a server environment variable.
- It is never sent to the browser, logged, written to reports, or committed. `.env` is ignored by Git.
- Traces and provenance records show request parameters with no credentials.

## Retention

Cases are stored in SQLite on the server and removed after a period of inactivity, 48 hours by default. A person can delete a case at any time from its History tab.

## Guidance for people entering data

Use public names such as artists, films, genres or moods. Do not enter the names of people you know. Do not enter street addresses. Keep notes about what must survive general, because they stay on the server but are visible in the case history.
