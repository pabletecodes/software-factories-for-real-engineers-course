# Survey: events that could become Notifications

Research for [#2](https://github.com/pabletecodes/software-factories-for-real-engineers-course/issues/2), a child of the map [#1 Wayfinder: In-app Notifications](https://github.com/pabletecodes/software-factories-for-real-engineers-course/issues/1).

**Question.** Which events in Cadence affect a Student or Instructor? For each one: who it affects, where it happens in the code, and what data is available at that point. This is a catalogue to choose from. It does not choose which events become Notifications.

**Source.** The code at commit `33502c6`: `app/db/schema.ts`, `app/routes/*` and `app/lib/*`. Every `file:line` below points at that commit. The vocabulary comes from `GLOSSARY.md`. Note that `GLOSSARY.md` exists only in the main checkout; it is not committed at `33502c6`.

**Recipients.** Only Students and Instructors receive Notifications. Platform Admins and Team Admins are not recipients, but the actions they take are listed when those actions affect a Student or Instructor.

**Triggered by** says who causes the event:

- **Other**: another person caused it. These are strong candidates.
- **Self**: the recipient caused it. These are weak candidates.
- **Derived/Time**: no one acts directly; the event follows from a threshold or a date.

## Headline findings

1. **No code decides a Refund Request.** The only thing that writes to `refunds` is the Student raising a request (`app/routes/courses.$slug.refund.ts:215-223`). No code sets `RefundStatus.Approved` or `RefundStatus.Declined`. There is no admin refunds route, and nothing writes `resolvedAt` or `resolvedByUserId`, even though the columns exist (`app/db/schema.ts:250-251`). "Refund Request approved/declined" is the strongest candidate event for a Student, but it has no mutation to attach to yet.
2. **The Refund itself (Pending, Issued or Failed) is not modelled.** The `refunds` table holds the request status (`requested/approved/declined`, `schema.ts:34-38`) and `amountRefunded`. It has no column for whether the money was sent. Approving a request should also end the Enrollment or the Unclaimed Seats (glossary), but no code ever deletes an Enrollment or invalidates a Seat.
3. **Course completion is never recorded.** `enrollments.completedAt` (`schema.ts:134`) is read by the dashboard and the instructor pages, but no code writes it, so "Student completed a course" has no trigger point.
4. **There is a precedent for messaging a user.** Raising a Refund Request builds a confirmation email and logs it to the console, because no mail transport exists (`courses.$slug.refund.ts:88-112, 225-234`). That email body promises "we will email you again when it is done". Enrolling has a stub for a welcome email that does nothing (`courses.$slug.purchase.tsx:164-166`). The rest of the code has no notification or messaging infrastructure, and nothing is scheduled or time-based (no cron jobs or queues).
5. **Saving a quiz silently deletes every Student's attempts.** The `save-quiz` intent deletes the existing quiz first (`instructor.$courseId.lessons.$lessonId.quiz.tsx:399-403`). `deleteQuiz` deletes all of that quiz's `quizAttempts` and `quizAnswers` (`:201-219`). So when an Instructor edits a quiz, Students lose their results without being told.

## Catalogue

### Refunds

| # | Event (glossary terms) | Affects | Triggered by | Where (mutation) | Data available there |
|---|---|---|---|---|---|
| R1 | **Refund Request raised** by a Student on their Individual Purchase | Student (as a confirmation); the Instructor of the course (a Student wants their money back) | Self for the Student; Other for the Instructor | `app/routes/courses.$slug.refund.ts:215-223` (the `action` starts at `:114`) | `learner` (the full users row), `course` (full row, including `instructorId`), `purchase` (amountPaid, country, createdAt), `parsed.data.reason`, `refundableAmount` (`:205-206`), `watchedSeconds` (`:175-195`). The inserted refund row is returned but discarded, so its id is not kept. |
| R2 | **Refund Request approved** (an Approved Refund Request, which ends the Enrollment or the Unclaimed Seats) | Student (the buyer); the Instructor (loses the sale and the Student) | Other (a Platform Admin) | **No code.** The columns `refunds.status`, `amountRefunded`, `resolvedAt` and `resolvedByUserId` exist (`schema.ts:239-251`) but nothing writes them. | Would have the refund row, the purchase, the buyer and the deciding Platform Admin. |
| R3 | **Refund Request declined** (a Declined Refund Request; the buyer may raise a new one) | Student (the buyer) | Other (a Platform Admin) | **No code** (same as R2) | Same as R2 |
| R4 | **Refund issued** or **Refund failed** (the Pending Refund moves to Issued or Failed) | Student (the buyer) | Other or system (payment outcome) | **Not modelled.** There is no Refund money-status column in `schema.ts`. | none |
| R5 | **Watch Limit crossed**: the Student can no longer get a Refund | Student | Derived (from the Student's own watching) | The threshold is only checked when a request is raised (`courses.$slug.refund.ts:23, 197-201`). Watching is recorded at `app/routes/api.video-tracking.ts:29-38`. | At the video-tracking insert: userId, lessonId, positionSeconds. Working out the course total needs the query at `refund.ts:173-195`. |
| R6 | **Refund window closing or closed** (14 calendar days after the Purchase) | Student | Time | No trigger point; only checked at `courses.$slug.refund.ts:22, 74-86, 164-171` | `purchase.createdAt` |

### Purchases, Enrollments and Seats

| # | Event | Affects | Triggered by | Where | Data available there |
|---|---|---|---|---|---|
| P1 | **Individual Purchase** made and **Enrollment** created | Instructor (new sale, new Student); Student (a receipt or welcome) | Other for the Instructor; Self for the Student | `app/routes/courses.$slug.purchase.tsx:366-373`, which calls `createPurchase` (`:180-191`) and `enrollUser` (`:145-178`, insert at `:167-171`; the empty email stub is at `:164-166`) | `currentUserId`, `course` (full row, including `instructorId`, title, slug), `pppPrice`, `country`. The purchase and enrollment rows are returned by the helpers but not kept in the action. |
| P2 | **Team Licence** bought, with Seats generated | Instructor (a sale, N Seats); the Team Admin (out of scope) | Other for the Instructor | `courses.$slug.purchase.tsx:375-378` → `createTeamPurchase` (`:245-259`), `generateCoupons` (`:222-243`) | currentUserId (the Team Admin), course, quantity, totalPrice, country, the team and its coupons (returned) |
| P3 | **Seat claimed**: a Claimed Seat gives a Student an **Enrollment** | Instructor (new Student on the course); the Student who claimed it (Self); the Team Admin who bought the Licence (not a recipient, but see the open question below) | Other for the Instructor; Self for the claimer | `app/routes/redeem.$code.tsx:84-97` inside `redeemCoupon` (`:41-100`), called from the action at `:179` | `coupon` (teamId, courseId, purchaseId), `purchase` (the Team Admin's userId, country), userId of the claimer, the new `enrollment`. The course is loaded at `:186`. |
| P4 | **Enrollment ended** (Lapsed), for example after an Approved Refund Request | Student | Other | **No code.** Nothing deletes `enrollments`. | none |
| P5 | **Course completed** (`enrollments.completedAt` set) | Student (Self); Instructor (Other) | Self or Derived | **No code writes it.** It is read at `app/routes/dashboard.tsx:27, 213` and `instructor.$courseId.students.tsx:37`. | none |

### Comments: questions and replies on lessons

`comments` has top-level comments and replies one level deep (`schema.ts:323-355`). The Instructor queue treats a top-level comment from a non-staff author as a question. The question counts as "unanswered" until the owning Instructor or a Platform Admin replies (`app/routes/instructor.questions.tsx:42-97`).

| # | Event | Affects | Triggered by | Where | Data available there |
|---|---|---|---|---|---|
| C1 | A Student **posts a question** (a top-level comment) on a lesson | Instructor of the course | Other | `app/routes/courses.$slug.lessons.$lessonId.tsx:903-909` (create-comment intent) → `createComment` `:404-435`, insert at `:431` | currentUserId, lessonId, body, parentId = null. `createComment` loads `course` with `getCourseForLesson` (which includes the instructor). The `access` object holds isStaff/isOwningInstructor (`:895`, `app/lib/access.server.ts`). The inserted row is returned. |
| C2 | Someone **replies** to a Student's question on the lesson page: the Instructor, a Platform Admin, or another Student | Student (the question's author) | Other, unless they reply to themselves | Same path as C1, with `parentId` set (`courses.$slug.lessons.$lessonId.tsx:903-909, 404-435`) | Same as C1, plus `parent` (the question row, including its author's `userId`), loaded at `:418` |
| C3 | Instructor or Platform Admin **answers a question** from the "Questions" queue | Student (the question's author) | Other | `app/routes/instructor.questions.tsx:211-216` → `createComment` `:118-160`, insert at `:153` | `question` (the comment row, including the author's userId and lessonId), `course` (courseId, instructorId, from `getCourseForLesson` `:103-116`), `access.userId` (the replier), body |
| C4 | A Student **replies in a thread the Instructor started or already answered** | Instructor | Other | Same as C2 | Same as C2 |
| C5 | Other participants reply in a thread the recipient already replied in | Student / Instructor (the earlier repliers) | Other | Same as C2. The thread participants would need a query on `comments.parentId`. | Same as C2 |
| C6 | Staff **deletes someone else's comment** (moderation; a soft delete) | Student (the comment's author) | Other (the owning Instructor or a Platform Admin) | `courses.$slug.lessons.$lessonId.tsx:935` → `deleteComment` `:459-479` (the staff override is at `:464`, the update at `:472`) | commentId, currentUserId (the deleter), `existing` row (including the author's userId), `access.isStaff` |
| C7 | A comment is edited | Thread participants | Self for the author (only authors can edit, `:447`) | `courses.$slug.lessons.$lessonId.tsx:923` → `updateComment` `:437-457` | Weak candidate |

### Ratings

| # | Event | Affects | Triggered by | Where | Data available there |
|---|---|---|---|---|---|
| T1 | A Student **rates a course** (new rating) or **changes their rating** | Instructor | Other | `app/routes/courses.$slug.tsx:613` → `rateCourse` `:335-371` (update `:356`, insert `:364`) | currentUserId, `course` (full row), rating (1–5). Whether the rating is new or changed is known inside `rateCourse` (an existing rating is found by `findRating`). |

### Quizzes and lesson progress

| # | Event | Affects | Triggered by | Where | Data available there |
|---|---|---|---|---|---|
| Q1 | Student **submits a quiz**: a passed or failed attempt | Student (Self); Instructor (Other) | Self for the Student; Other for the Instructor | `courses.$slug.lessons.$lessonId.tsx:970` → `computeResult` `:531-…`, insert into `quizAttempts` at `:602-611` | userId, quizId, score, passed, grade, the per-question results; `course` (loaded by slug in the action at `:875`) |
| Q2 | Student **marks a lesson complete** | Student (Self); Instructor (Other) | Self | `courses.$slug.lessons.$lessonId.tsx:947-949` → `markLessonComplete` `:218-243` | userId, lessonId, `course` |
| Q3 | Instructor **saves (rewrites) or deletes a quiz**, which **wipes every Student's attempts** | Students with attempts on that quiz | Other (the Instructor or a Platform Admin) | `app/routes/instructor.$courseId.lessons.$lessonId.quiz.tsx:386-422` (save) and `:425-430` (delete) → `deleteQuiz` `:201-219` | lessonId, the existing quiz. The affected Students would have to be found by querying `quizAttempts` **before** the delete. |

### Course and lesson changes by Instructors and Platform Admins

| # | Event | Affects | Triggered by | Where | Data available there |
|---|---|---|---|---|---|
| K1 | **Course status changed by its Instructor** (Draft, Published or Archived) | Enrolled Students (mainly for Archived) | Other for Students | `app/routes/instructor.$courseId.tsx:695-697` → `updateCourseStatus` `:154-161` | courseId, the new status, `course` (old row, so the old status is known) |
| K2 | **Course status changed by a Platform Admin** (for example un-publishing or archiving an Instructor's course) | Instructor (the owner); enrolled Students | Other | `app/routes/admin.courses.tsx:141-143` → `updateCourseStatus` `:76-83` | courseId, the new status, the returned course row (including `instructorId`) |
| K3 | **New lesson added** to a course | Enrolled Students | Other | `instructor.$courseId.tsx:753-763` → `createLesson` `:265-293` | moduleId, title, courseId. The enrolled Students would need a query (as at `:369`). |
| K4 | **Lesson content or video updated** | Enrolled Students | Other | `app/routes/instructor.$courseId.lessons.$lessonId.tsx:207` → `updateLesson` `:66-91` | courseId, lessonId, the new fields |
| K5 | Lesson or module **deleted**, or lessons reordered or moved | Enrolled Students | Other | `instructor.$courseId.tsx:740-750, 827-841` (delete), `:783-826` (reorder and move) | ids only. A deleted lesson's title is not kept unless it is read first. |
| K6 | Course title, description, sales copy, price or PPP changed | (Students on the sales page; Instructor is Self) | Self / Other | `instructor.$courseId.tsx:685-721, 844-…` | Weak candidate |

### Accounts

| # | Event | Affects | Triggered by | Where | Data available there |
|---|---|---|---|---|---|
| A1 | A Platform Admin **changes a user's role** (for example Student to Instructor) | That Student or Instructor | Other | `app/routes/admin.users.tsx:126-129` → `updateUserRole` `:60-67` | userId, the new role, currentUser (the Platform Admin) |
| A2 | A Platform Admin **edits a user's name, email or bio** | That user | Other | `admin.users.tsx:119-124` → `updateUser` `:46-58` | userId, name, email |
| A3 | User edits their own profile in Settings, or signs up | That user | Self | `app/routes/settings.tsx:115-120`; `app/routes/signup.tsx:78` | Weak candidate |

### Recorded but not candidate events (self-only, and too frequent to notify about)

- Video watch events, recorded at `api.video-tracking.ts:29-38`. These matter only as the source of R5.
- Lesson marked in progress (`courses.$slug.lessons.$lessonId.tsx:245-271`).
- Course created by an Instructor (`app/routes/instructor.new.tsx:46-81`), which affects no one else.

## Summary by recipient

**Student, triggered by another person (strong candidates):**

- Refund Request approved or declined (R2, R3). No code exists for these yet.
- Refund issued or failed (R4). Not modelled.
- Reply to their question, from the Instructor, a Platform Admin or another Student (C2, C3, C5).
- Their comment removed by staff (C6).
- Quiz attempts wiped by a quiz edit (Q3).
- Course archived or un-published (K1, K2).
- New or changed lessons (K3–K5).
- Role or profile changed by a Platform Admin (A1, A2).
- Enrollment ended (P4). No code exists yet.

**Student, self-triggered or derived (weak candidates):** Refund Request raised (R1, which already has an email stub); Individual Purchase or Seat claimed (P1, P3); quiz result (Q1); Watch Limit crossed or refund window closing (R5, R6, which have no trigger point).

**Instructor, triggered by another person:**

- New question on their course (C1), or a reply in a thread they are in (C4, C5).
- New Individual Purchase or Enrollment (P1), Team Licence bought (P2), Seat claimed (P3).
- A Refund Request raised on their course (R1), or later approved (R2, no code yet).
- New or changed rating (T1).
- Their course's status changed by a Platform Admin (K2).
- A Student passes a quiz or completes a lesson (Q1, Q2). These would be high-volume.
- Role changed by a Platform Admin (A1).

## Open points for the grilling ticket

- **A Team Admin is a Student in the glossary.** Should "a Seat on your Team Licence was claimed" (P3) or a decision on a Team Licence's Refund Request reach them in their capacity as a Student? The ticket's scope excludes Team Admins as recipients.
- **R2, R3, R4, P4 and P5 depend on features that do not exist yet:** deciding a Refund Request, tracking a Refund's money status, ending an Enrollment, and recording course completion. Each of those Notifications would have to be built together with its feature, or deferred.
- **Comment threads.** The definitions of "question", "answered" and "unanswered" live in `instructor.questions.tsx:42-97`. They are not in the glossary.
