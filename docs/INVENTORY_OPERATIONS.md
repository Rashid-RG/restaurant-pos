# Inventory operations

This revision adds actual owner/manager workflows and responsive UI to the staff Inventory workspace. It does not enable a supplier payment service or alter the original production deployment.

## Workflows

- **Suppliers:** create and browse restaurant-owned supplier contact records.
- **Purchases:** create multi-line orders with purchase units, quantities and costs; inspect ordered/received quantities; receive partially or fully; cancel only the outstanding commitment. Creating a purchase does not change stock.
- **Receiving:** convert kg/g and L/ml to ingredient base units; update stock and weighted average cost in the same transaction as received quantities and the action journal. An incompatible unit, shortage or later invalid line rolls back the whole operation.
- **Counts:** snapshot tracked ingredient or menu quantities, enter physical counts and complete the count. Any changed stock causes a conflict instead of overwriting intervening sales. Cancelled drafts do not change stock.
- **Waste:** record a reason, quantity and cost; reject unavailable quantities rather than clamping stock to zero.
- **Recipes:** select a menu item, edit ingredient quantities in base units and view ingredient cost per portion. Prior order reservations retain their saved recipe quantities. Labor, overhead, fees and yield are not included in this cost.
- **History:** view tenant-owned movements and manager action records. Append-only database triggers reject updates/deletes of action and movement journals.

## API surface

All paths below are under `/api` and require fresh authenticated owner/manager authorization in the restaurant context.

| Methods | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/inventory/suppliers` | List/create suppliers |
| GET, POST | `/inventory/purchases` | List/create purchases |
| GET | `/inventory/purchases/:id` | Purchase detail |
| POST | `/inventory/purchases/:id/receive` | Transactional receipt |
| POST | `/inventory/purchases/:id/cancel` | Close outstanding purchase |
| GET, POST | `/inventory/counts` | List/start physical counts |
| POST | `/inventory/counts/:id/complete` | Apply checked count variance |
| POST | `/inventory/counts/:id/cancel` | Cancel draft |
| POST | `/inventory/waste` | Deduct and record waste |
| GET, POST | `/inventory/recipes/:menuId` | Read/update recipe |
| GET | `/inventory/activity` | Latest 200 manager actions |
| GET | `/inventory/movements` | Latest 300 stock movements |

The canonical POST `/ingredients` handler also preserves recipes on ingredient edits, validates units and records opening stock/manager adjustments. Menu metadata upserts preserve dependent recipe and order-item rows.

Mutation clients should send a stable private `requestId` for retries. The journal binds the ID to the normalized payload; a changed payload conflicts. Some legacy create/edit callers may omit the ID and receive a generated one, which cannot automatically protect a retry from that client. The new UI persists its frozen pending request in session storage scoped to the restaurant/user and offers **Retry saved update** after an unknown response. Success clears the pending mutation before refreshing data. A refresh error cannot resubmit the mutation.

## Validation and limits

34 new automated tests bring the suite to 287. They cover authorization/isolation, idempotency, quantity/unit/cost rules, partial receipt rollback, stale count rejection, recipe preservation and immutable history. Local browser checks exercise supplier → purchase → receipt response loss → reload/recovery → ingredient count → waste, plus recipe editing and menu count. The responsive check covers six tabs at 320, 768, 844 and 1920 pixel widths and reachable dialog controls.

Local tests are not proof of cloud concurrency or real supplier accounting. Existing direct/legacy stock endpoints require broader journal consolidation. The new UI uses receipt/count/waste operations rather than stale client-calculated absolute adjustments, but this is not a claim that every historical stock change is journaled. Supplier returns/credits, expiry/batches, tax invoices, yield and reorder forecasting remain out of scope for this increment. Histories use bounded recent lists and need pagination/export for long-term operational use.

Schema initialization adds purchase/count/action tables and indexes without dropping existing tables. Restore and original-production migration must include the new tables and append-only trigger behavior. The previous 41-table staging recovery drill predates this schema and must be repeated before production approval.
