# The PPP country check reads the latest live Individual Purchase, and a Claimed Seat exempts it

A Student can hold several Purchases of one course: an Individual Purchase whose Refund Request was approved, a later one bought again, a Team Licence they bought for others. The country check from ADR-0009 reads only the newest Individual Purchase with no Approved Refund Request, because that is the Purchase behind their Enrollment. A Student who also holds a Claimed Seat on the course is never checked: the Seat alone gives them the Enrollment (ADR-0004), and the Team Admin, not the Student, was the buyer.

## Considered Options

- **Whichever Purchase the database returns first**: what the code used to do. A refunded discounted Purchase, or a Team Licence, could block a Student who later bought at full price.
- **Any live discounted Individual Purchase blocks**, or **any full-price one unlocks**: rejected as rules for a case that shouldn't happen. An enrolled Student is turned away from buying again, so at most one Individual Purchase should be live, and the latest one is it.
- **Lock a Claimed Seat to the Team Licence's country**: rejected, because the country rule is about where the buyer was, and the Student holding the Seat didn't buy it.
