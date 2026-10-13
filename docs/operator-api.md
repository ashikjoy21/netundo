# netundo Operator Updates API

Internet providers and local cable operators can post status updates about outages
("investigating", "fixing", "restored"). netundo shows them in the **Right now**
section of every affected district, taluk and village page, marked as coming from the operator.

The API is small and stable so that it can be driven by automation, such as LNO360's OLT
monitoring, as well as by people.

- **Base URL:** `https://api.netundo.com`
- **Format:** JSON request and response bodies (`Content-Type: application/json`)
- **Auth:** `Authorization: Bearer nu_op_…` (one token per operator)
- **Rate limit:** 60 requests per minute per operator (`429` when exceeded)

## Getting a token

Tokens are issued by the netundo maintainer:

```bash
node scripts/create-operator-token.mjs --name "Kerala Vision NOC" --brand kerala-vision \
  --districts Ernakulam,Kollam            # optional scope; omit for all of Kerala
```

- **The token is shown once**, and only its SHA-256 hash is stored.
- **`--brand`** sets which provider the operator speaks for. Use a brand slug from
  `packages/types/src/providers.ts` (`kerala-vision`, `asianet`, `bsnl`, …) or a local cable
  operator key `lco:<name-slug>`, for example `lco:sree-cable-network`. This is the same key that
  outage reports for that operator use.
- **To revoke a token:** `update operators set active = false where name = '…';`

## The update object

```json
{
  "id": "6f1c…",
  "operator": "Kerala Vision NOC",
  "provider": "Kerala Vision",
  "brand_key": "kerala-vision",
  "kind": "broadband",
  "status": "fixing",
  "message": "Fibre cut near Kakkanad junction. Splicing team on site.",
  "eta": "2026-10-13T15:30:00.000Z",
  "updated_at": "2026-10-13T13:05:12.000Z",
  "areas": [{ "district": "Ernakulam", "taluk": "Kanayannor" }]
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | `investigating` \| `fixing` \| `restored` | Required on create. |
| `message` | string, 3–500 chars | Required on create. Links, phone numbers and abusive language are rejected. |
| `eta` | ISO 8601 timestamp or `null` | Estimated restore time. It's shown in IST, so include a timezone (`+05:30` or `Z`). |
| `kind` | `broadband` \| `mobile` \| `null` | `null` (the default) means both. |
| `areas` | 1–50 `{ "district", "taluk"? }` | Use canonical names (see [Area names](#area-names)). Leaving out `taluk` means the whole district. Areas must fall within the token's allowed districts. |
| `external_ref` | string ≤ 100 chars, optional | Your own incident ID. A POST with an `external_ref` you have already used **updates** that record instead of creating a new one, so retries from automation are safe. |

**Visibility:** an open update (investigating or fixing) is shown until 24 h after its last
change. A `restored` update stays visible for 2 h so people see the all-clear.

## Endpoints

### `POST /v1/operator/updates`: create an update

```bash
curl -X POST https://api.netundo.com/v1/operator/updates \
  -H "Authorization: Bearer $NETUNDO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "investigating",
    "message": "We are aware of an outage around Kakkanad and are investigating.",
    "kind": "broadband",
    "areas": [{ "district": "Ernakulam", "taluk": "Kanayannor" }],
    "external_ref": "OLT-KKD-2026-10-13-01"
  }'
```

This returns `201 { "update": { … } }`. If the `external_ref` already exists, you get
`200 { "update": { … } }` and the existing record is updated.

### `PATCH /v1/operator/updates/:id`: change an update

Send only the fields you want to change. When you send `areas`, the whole area list is replaced.

```bash
curl -X PATCH https://api.netundo.com/v1/operator/updates/6f1c… \
  -H "Authorization: Bearer $NETUNDO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "fixing", "message": "Fibre cut found. Splicing team on site.", "eta": "2026-10-13T21:00:00+05:30" }'
```

To mark the outage as resolved:

```bash
curl -X PATCH https://api.netundo.com/v1/operator/updates/6f1c… \
  -H "Authorization: Bearer $NETUNDO_TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "restored", "message": "Service restored. Thanks for your patience." }'
```

This returns `200 { "update": { … } }`. Updates belonging to another operator return `404`.

### `GET /v1/operator/updates[?active=1]`: list your updates

```bash
curl https://api.netundo.com/v1/operator/updates?active=1 -H "Authorization: Bearer $NETUNDO_TOKEN"
```

This returns `200 { "operator": { "name", "brand_key" }, "updates": [ … ] }`. The list holds the
newest 100 updates, and each one includes `external_ref` and `visible`.

## Errors

Every error is JSON with a human-readable `error`. Validation errors also name the `field`.

```json
{ "error": "Unknown taluk \"Kozhikode\" in Ernakulam", "field": "areas[0].taluk" }
```

| Status | Meaning |
|---|---|
| `400` | The body isn't a JSON object, or the id is malformed |
| `401` | The token is missing, malformed or revoked |
| `404` | The update doesn't exist or isn't yours |
| `422` | Validation failed (see `field`) |
| `429` | The rate limit was exceeded |
| `502` / `503` | Temporary backend problem. Retry with backoff, using the same `external_ref` |

## Area names

Districts are the 14 Kerala districts, spelled as `Thiruvananthapuram`, `Kollam`,
`Pathanamthitta`, `Alappuzha`, `Kottayam`, `Idukki`, `Ernakulam`, `Thrissur`, `Palakkad`,
`Malappuram`, `Kozhikode`, `Wayanad`, `Kannur` and `Kasaragod`.

Taluks must use the names in `packages/types/src/places.ts` (`KERALA_TALUKS`), for example
`Kanayannor`, `Aluva`, `Sulthan Bathery`.

## Public read endpoints (no auth)

These endpoints are useful for dashboards:

- `GET /v1/status?district=Ernakulam&taluk=Kanayannor` returns user reports from the last 60
  minutes for that area, grouped by provider and connection type. Each group carries a
  `likely_outage` flag, and the response includes active `operator_updates`.
- `GET /v1/outages/active` returns every live likely outage across Kerala.
