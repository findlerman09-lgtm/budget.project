# Personal Budget App

A self-contained browser budget app (`index.html` with a separate month-end report module). No server, no accounts — all data lives in your browser's localStorage.

The app ships **empty**: no accounts, no transactions, zero balances. To load data, go to **Backup/Import** and import a previously exported JSON backup. Without a backup file it's just a blank app anyone can use.

**Back up regularly** — data exists only in the browser it was entered in. Use *Backup/Import → Export JSON Backup* and keep the file somewhere safe (not in this repository).

## Month-end analysis

Open **Backup, Reports & Import → Build Month-End Report** to export a self-contained HTML analysis. The report includes monthly and year-to-date cash flow, funded bucket performance, envelope balances, major expenses, data-quality checks, and conservative year-end projections. Optional future one-time income and expense adjustments can be supplied when exporting.

The report treats credit-card payments as transfers and keeps bucket funding separate from cash flow, so already-funded envelopes are not counted as new income.

### Optional planning layer

The same page also contains **Planning & Month Close**. This additive layer can:

- save dated future income and expense events for projections;
- infer remaining paycheck dates or use explicit forecast dates and cadence;
- create a month-end snapshot that preserves the report's account, card, bucket, and projection values;
- optionally advance the active month after a snapshot is saved.

Planning records do not create transactions, change balances, allocate buckets, or alter paycheck holding. Month closing does not lock the live ledger, and advancing the active month is always unchecked by default. Existing version 5 backups remain compatible because all new fields are optional.

Run the calculation checks with:

```bash
node tests/month-end-report.test.js
node tests/planning-layer.test.js
```
