# Phase 4B–5 Contract and Handover Postman Checks

Use isolated test fixtures and test accounts only. Do not edit database records directly or mark a PayOS payment successful. Authenticate separately as the owning Customer and as Staff/Manager assigned to the Reservation Facility.

## Shared reads

1. Customer: `GET {{baseUrl}}/api/v1/reservations/{{reservationId}}` — verify owner, service, dates, allocation and server status.
2. Customer: `GET {{baseUrl}}/api/v1/contracts/reservation/{{reservationId}}` — verify the linked Contract and current document version/hash.
3. Customer: `GET {{baseUrl}}/api/v1/reservations/{{reservationId}}/payments/{{paymentId}}` (Managed: `/api/v1/reservations/managed/{{reservationId}}/payments/{{paymentId}}`) — require `purpose=FULL_RENT`, `status=SUCCEEDED`, `providerSettlementStatus=VERIFIED`, `applicationStatus=APPLIED`.

## Self Storage

1. After the real signed PayOS webhook has applied full rent, Customer reads the Reservation and Contract as above. Expected: Reservation `PAID`, Contract `DRAFT`, no access credential.
2. Staff creates/refreshes the linked Contract using the existing supported Self Storage contract flow. The current implementation creates the initial DRAFT Contract with the Reservation; do not create a duplicate.
3. At the Facility, Staff verifies identity and both parties sign the same printed document. Staff submits actual evidence:

   `POST {{baseUrl}}/api/v1/contracts/{{contractId}}/confirm-signed-paper`

   `multipart/form-data`: `proofFile` = actual signed paper scan/photo; `documentVersion` = current integer version; `documentHash` = current hash; `customerSignedAt` and `facilitySignedAt` = actual ISO timestamps; `customerIdentityVerified=true`; optional `paperContractNumber`.

   Expected: `Contract=SIGNED` with proof and verifier metadata; `Reservation=CHECKIN_READY`. Stale version/hash, missing evidence, late deadline, wrong Facility or missing applied payment returns a controlled error.
4. Facility Staff records physical handover:

   `POST {{baseUrl}}/api/v1/reservations/{{reservationId}}/handover`

   JSON: `{ "customerIdentityVerified": true, "storageCondition": "GOOD" }`.

   Expected: `Reservation=ACTIVE`, no fabricated PIN; response reports `accessProvisioning.status=UNAVAILABLE` until a secure credential provider is integrated.

## Managed Inventory V3

1. Customer reads the Reservation, FULL_RENT payment and linked Contract. Expected: applied payment, protected reserved Cells, Contract `DRAFT`, start-date-derived exclusive `signingDeadline`.
2. Assigned Staff/Manager creates or retrieves the existing linked Contract:

   `POST {{baseUrl}}/api/v1/reservations/managed/{{reservationId}}/contract`

   Expected: same Contract ID on replay; snapshot contains Cells, capacity, dates, frozen price/payment reference and Terms acceptance.
3. Customer and an authorized Facility representative sign the same actual paper document. Assigned Staff/Manager uploads it through `POST /api/v1/contracts/{{contractId}}/confirm-signed-paper` with the multipart fields described above. The uploader is the Facility signer/verifier; Customer and Facility timestamps identify the distinct signers. No Customer signature button is an evidence source.
4. Expected state is Contract `SIGNED` + verified proof and Reservation `CHECKIN_READY`.
5. Staff records Cell handover:

   `POST {{baseUrl}}/api/v1/reservations/managed/{{reservationId}}/handover`

   JSON: `{ "storageCondition": "GOOD", "accessNotes": "Handover acknowledged" }`.

   Expected: `ACTIVE` after start date and valid allocation. This does not create inventory or bypass inbound Access Session, escort/presence, capacity or ledger checks.

## Negative checks

- Customer attempting paper verification or handover: denied.
- Staff assigned to a different Facility: not found/denied without contract disclosure.
- Missing/legacy/unapplied payment, wrong service, wrong document version/hash, absent signature timestamp/evidence, or expired deadline: no transition.
- A Customer return URL or frontend state alone never changes payment, Contract, Reservation or access state.
- An expired full-upfront signing deadline remains paid and allocated for manual review; this phase does not auto-cancel or refund it.
