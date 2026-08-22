# Statement JSON format

Minimal structure:

```json
{
  "source": "Bank statement description",
  "walletId": "MONEY_LOVER_WALLET_ID",
  "statement": {
    "statementDate": "2026-08-31",
    "expectedNet": 155000
  },
  "transactions": [
    {
      "key": "stable-unique-key",
      "date": "2026-08-25",
      "postDate": "2026-08-26",
      "amount": 120000,
      "direction": "expense",
      "merchant": "MERCHANT NAME",
      "categoryName": "Đi chợ",
      "note": "Readable note",
      "review": false
    }
  ]
}
```

## Top-level fields

- `source`: human-readable source label.
- `walletId`: target Money Lover wallet ID. If omitted, `ML_WALLET_ID` may supply it.
- `statement.expectedNet`: expected `expenseTotal - incomeTotal` after normalization. Strongly recommended.
- `statement.statementBalance`: used as fallback when `expectedNet` is absent.
- `runtimeCategoryOverrides`: optional per-file overrides; prefer the local ignored config file for account-specific IDs.
- `transactions`: non-empty array.

## Transaction fields

- `key`: stable unique label for reporting. If omitted, `row-N` is generated.
- `date`: required `YYYY-MM-DD` transaction date.
- `postDate`: optional `YYYY-MM-DD` posting date.
- `amount`: required positive number.
- `direction`: `expense` or `income`. Any value other than `income` is normalized to `expense`, so use explicit values.
- `merchant`: raw/normalized merchant text.
- `categoryName`: exact Money Lover category name. If omitted, merchant rules may fill it.
- `note`: note written into Money Lover. Falls back to merchant.
- `review`: when `true`, forces the row into review status even if all technical checks pass.

## Reconciliation

The bridge computes:

```text
net = sum(expense) - sum(income)
```

If `expectedNet`/`statementBalance` is present, import is blocked when the difference is non-zero unless `--allow-mismatch` is explicitly supplied.
