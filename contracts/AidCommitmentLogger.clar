(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AID-TYPE u101)
(define-constant ERR-INVALID-LOCATION u102)
(define-constant ERR-INVALID-QUANTITY u103)
(define-constant ERR-INVALID-TIMELINE u104)
(define-constant ERR-INVALID-STATUS u105)
(define-constant ERR-COMMITMENT-ALREADY-EXISTS u106)
(define-constant ERR-COMMITMENT-NOT-FOUND u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u109)
(define-constant ERR-INVALID-DETAILS u110)
(define-constant ERR-INVALID-HASH u111)
(define-constant ERR-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-COMMITMENTS-EXCEEDED u114)
(define-constant ERR-INVALID-VERIFIED u115)
(define-constant ERR-INVALID-ORG u116)
(define-constant ERR-DUPLICATION-DETECTED u117)
(define-constant ERR-INVALID-START u118)
(define-constant ERR-INVALID-END u119)
(define-constant ERR-INVALID-VERIFIER u120)

(define-data-var next-commitment-id uint u0)
(define-data-var max-commitments uint u100000)
(define-data-var logging-fee uint u100)
(define-data-var authority-contract (optional principal) none)

(define-map commitments
  uint
  {
    id: uint,
    org: principal,
    aid-type: uint,
    location: (string-ascii 50),
    quantity: uint,
    timeline: { start: uint, end: uint },
    status: (string-ascii 20),
    hash: (string-ascii 64),
    timestamp: uint,
    verified: bool
  }
)

(define-map commitments-by-hash
  (string-ascii 64)
  uint)

(define-map commitment-updates
  uint
  {
    update-status: (string-ascii 20),
    update-verified: bool,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-commitment (id uint))
  (map-get? commitments id)
)

(define-read-only (get-commitment-updates (id uint))
  (map-get? commitment-updates id)
)

(define-read-only (is-commitment-registered (hash (string-ascii 64)))
  (is-some (map-get? commitments-by-hash hash))
)

(define-private (validate-aid-type (type uint))
  (if (and (> type u0) (<= type u100))
      (ok true)
      (err ERR-INVALID-AID-TYPE))
)

(define-private (validate-location (loc (string-ascii 50)))
  (if (and (> (len loc) u0) (<= (len loc) u50))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-quantity (qty uint))
  (if (> qty u0)
      (ok true)
      (err ERR-INVALID-QUANTITY))
)

(define-private (validate-timeline (tl { start: uint, end: uint }))
  (if (and (> (get start tl) u0) (> (get end tl) (get start tl)))
      (ok true)
      (err ERR-INVALID-TIMELINE))
)

(define-private (validate-status (st (string-ascii 20)))
  (if (or (is-eq st "pending") (is-eq st "delivered") (is-eq st "disputed") (is-eq st "cancelled"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-hash (h (string-ascii 64)))
  (if (is-eq (len h) u64)
      (ok true)
      (err ERR-INVALID-HASH))
)

(define-private (validate-verified (v bool))
  (ok true)
)

(define-private (validate-org (o principal))
  (if (not (is-eq o 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-ORG))
)

(define-private (validate-start (s uint))
  (if (> s u0)
      (ok true)
      (err ERR-INVALID-START))
)

(define-private (validate-end (e uint))
  (if (> e u0)
      (ok true)
      (err ERR-INVALID-END))
)

(define-private (validate-verifier (v principal))
  (if (not (is-eq v tx-sender))
      (ok true)
      (err ERR-INVALID-VERIFIER))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-org contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-commitments (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-COMMITMENTS-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-commitments new-max)
    (ok true)
  )
)

(define-public (set-logging-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set logging-fee new-fee)
    (ok true)
  )
)

(define-public (log-commitment
  (aid-type uint)
  (location (string-ascii 50))
  (quantity uint)
  (timeline { start: uint, end: uint })
  (details-hash (string-ascii 64))
)
  (let (
        (next-id (var-get next-commitment-id))
        (current-max (var-get max-commitments))
        (authority (var-get authority-contract))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-COMMITMENTS-EXCEEDED))
    (try! (validate-aid-type aid-type))
    (try! (validate-location location))
    (try! (validate-quantity quantity))
    (try! (validate-timeline timeline))
    (try! (validate-hash details-hash))
    (asserts! (is-none (map-get? commitments-by-hash details-hash)) (err ERR-COMMITMENT-ALREADY-EXISTS))
    (asserts! (is-ok (contract-call? .duplication-detector is-unique aid-type location quantity timeline)) (err ERR-DUPLICATION-DETECTED))
    (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get logging-fee) tx-sender authority-recipient))
    )
    (map-set commitments next-id
      {
        id: next-id,
        org: tx-sender,
        aid-type: aid-type,
        location: location,
        quantity: quantity,
        timeline: timeline,
        status: "pending",
        hash: details-hash,
        timestamp: block-height,
        verified: false
      }
    )
    (map-set commitments-by-hash details-hash next-id)
    (var-set next-commitment-id (+ next-id u1))
    (print { event: "commitment-logged", id: next-id })
    (ok next-id)
  )
)

(define-public (update-commitment
  (commitment-id uint)
  (new-status (string-ascii 20))
  (new-verified bool)
)
  (let ((commitment (map-get? commitments commitment-id)))
    (match commitment
      c
        (begin
          (asserts! (is-eq (get org c) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-status new-status))
          (try! (validate-verified new-verified))
          (asserts! (is-ok (contract-call? .oracle-integrator verify-update commitment-id new-status)) (err ERR-INVALID-UPDATE-PARAM))
          (map-set commitments commitment-id
            {
              id: (get id c),
              org: (get org c),
              aid-type: (get aid-type c),
              location: (get location c),
              quantity: (get quantity c),
              timeline: (get timeline c),
              status: new-status,
              hash: (get hash c),
              timestamp: block-height,
              verified: new-verified
            }
          )
          (map-set commitment-updates commitment-id
            {
              update-status: new-status,
              update-verified: new-verified,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "commitment-updated", id: commitment-id })
          (ok true)
        )
      (err ERR-COMMITMENT-NOT-FOUND)
    )
  )
)

(define-public (get-commitment-count)
  (ok (var-get next-commitment-id))
)

(define-public (get-by-location (loc (string-ascii 50)))
  (filter (lambda (entry) (is-eq (get location entry) loc)) (map-get? commitments))
)

(define-public (count-by-category (category uint))
  (fold + (map (lambda (entry) (if (is-eq (get aid-type entry) category) u1 u0)) (map-get? commitments)) u0)
)

(define-public (check-commitment-existence (hash (string-ascii 64)))
  (ok (is-commitment-registered hash))
)