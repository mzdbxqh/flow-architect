# Process Architecture

## L4: Order Processing

| Node ID | Type | Name | Parent | Role | RASCI |
|---------|------|------|--------|------|-------|
| l4-order | L4 | Order Processing | | order_manager | R |

### L5: Validate Order

| Node ID | Type | Name | Parent | Role | RASCI |
|---------|------|------|--------|------|-------|
| l5-validate | L5 | Validate Order | l4-order | validator | R |

#### L6: Check Stock Availability

| Node ID | Type | Name | Parent | Role | RASCI |
|---------|------|------|--------|------|-------|
| l6-check-stock | L6 | Check Stock Availability | l5-validate | stock_clerk | R |

## Relationships

- l4-order contains l5-validate
- l5-validate contains l6-check-stock
