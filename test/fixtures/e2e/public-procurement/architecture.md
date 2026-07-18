# Public Procurement Process Architecture

## L3 Process

| ID | Name | Owner |
|---|---|---|
| L3-PROC | Public Procurement | Procurement Department |

## L4 Sub-Processes

| ID | Name | Parent | Department | System | Timeframe | Location |
|---|---|---|---|---|---|---|
| L4-001 | Receive Application | L3-PROC | Reception, IT, Finance | Portal + ERP | Day 1-3 | HQ + Branch |
| L4-002 | Evaluate Vendor | L3-PROC | Evaluation Committee | ERP | Day 4-10 | HQ |
| L4-003 | Approve and Notify | L3-PROC | Management | ERP | Day 11-15 | HQ |

## L5 Activities

### L4-001: Receive Application

| ID | Name | Role | Input | Output |
|---|---|---|---|---|
| L5-001 | Submit Application | Applicant | Application Documents | Submitted Application |
| L5-002 | Log Application | Procurement Officer | Submitted Application | Logged Application |
| L5-003 | Review Completeness | Procurement Officer | Logged Application | Completeness Report |

### L4-002: Evaluate Vendor

| ID | Name | Role | Input | Output |
|---|---|---|---|---|
| L5-004 | Check Eligibility | Analyst | Logged Application | Eligibility Result |
| L5-005 | Score Proposal | Committee Member | Eligibility Result | Scored Proposal |

### L4-003: Approve and Notify

| ID | Name | Role | Input | Output |
|---|---|---|---|---|
| L5-006 | Approve Application | Manager | Scored Proposal | Approval Decision |
| L5-007 | Send Notification | Procurement Officer | Approval Decision | Notification |
| L5-008 | Receive Notification | Applicant | Notification | Receipt |

### Additional archive activity

| ID | Name | Parent | Role | Input | Output |
|---|---|---|---|---|---|
| L5-ORPHAN | Archive Documents | L4-NONEXISTENT | Archivist | Approval Decision | Archive Receipt |

## L6 Tasks

### L5-001: Submit Application

| ID | Name | Input | Output |
|---|---|---|---|
| L6-001 | Fill Online Form | Requirements | Form Data |
| L6-002 | Upload Documents | Documents | Document Set |

### L5-002: Log Application

| ID | Name | Input | Output |
|---|---|---|---|
| L6-003 | Enter to System | Form Data | System Record |

### L5-003: Review Completeness

| ID | Name | Input | Output |
|---|---|---|---|
| L6-004 | SAP_Vendor_Lookup | System Record | Vendor Profile |

### L5-004: Check Eligibility

| ID | Name | Input | Output |
|---|---|---|---|
| L6-005 | Verify Requirements | Vendor Profile | Eligibility Check |

### L5-005: Score Proposal

| ID | Name | Input | Output |
|---|---|---|---|
| L6-006 | Rate Criteria | Vendor Profile | Score Card |

### L5-006: Approve Application

| ID | Name | Input | Output |
|---|---|---|---|
| L6-007 | Review and Sign | Score Card | Signed Approval |

## SOP Entries

| SOP ID | Name | Parent | Owner | L6 Reference | Scope |
|---|---|---|---|---|---|
| SOP-001 | Standard Procurement | L3-PROC | Procurement Officer | L6-001, L6-002, L6-003, L6-005, L6-006, L6-007 | Universal |
| SOP-002 | Emergency Procurement | L3-PROC | Emergency Officer |  | Emergency Only |
