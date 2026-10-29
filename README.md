# ELV Cash

Cash receipts and till of the Erasmus Life Valencia office: https://erasmuslifevalencia.github.io/cash/

- **New receipt**: customer, who received the money, items with their prices, back office check (required), then prints the customer copy and the office copy on one A4 sheet.
- **Today**: cash received per day (trips & others + rents), receipts still to validate in the back office, reprint, cancel, search.
- **Till**: float + cash receipts since the last closing, closing with the counted cash (without the float), history.

Only the team's Google accounts can open it (Google sign-in, checked by the script against the `team` line of the Settings tab).

## Files
- `index.html`, `app.js`: the app. `config.js`: script address and Google client ID (both public by design, no secret here).
- The data stays in the Google Sheet "ELV – Cash receipts", through the "ELV Cash Receipts" Apps Script (`doPost`).
