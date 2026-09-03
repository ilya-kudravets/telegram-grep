# message-deletion Specification

## Purpose
Deleting found messages for everyone, on every device — the irreversible half of the product, so its failure modes matter as much as its happy path.

## Requirements

### Requirement: Deletion is for everyone

Deletion MUST be requested with revocation, so the message disappears for every participant and on every device, and the interface MUST describe it that way.

#### Scenario: Deleting own messages
- **WHEN** the user deletes selected messages
- **THEN** they are revoked rather than hidden locally

### Requirement: Batched by chat, within the API limit

Targets MUST be grouped per chat and sent in chunks no larger than the API accepts, so a selection spanning many chats and thousands of messages is one operation to the user.

#### Scenario: Deleting more than one chunk
- **WHEN** more messages than the per-call limit are selected in one chat
- **THEN** they are deleted in successive chunks and counted once in the result

### Requirement: Per-chat failures do not abort the rest

A failure for one chat MUST be recorded and reported while the remaining chats are still processed. Only messages actually deleted MUST be removed from the cache.

#### Scenario: No permission in one chat
- **WHEN** the user lacks the right to delete in one of the selected chats
- **THEN** the other chats are deleted, the failure is reported with its message, and the undeleted rows stay in the cache and remain findable

#### Scenario: Reporting the outcome
- **WHEN** a deletion finishes
- **THEN** the number deleted is reported, together with the number of failures and the first failure's message

### Requirement: Confirmation before an irreversible act

Every interface MUST confirm before deleting and MUST state how many messages are affected.

#### Scenario: Confirming in any client
- **WHEN** the user asks to delete a selection
- **THEN** a confirmation naming the count is required, and cancelling leaves everything in place
