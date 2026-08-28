# News image rights policy

Status: **approved interim product policy**  
Approved: 2026-08-28 by the product owner  
Scope: the Наясно news home page

This policy is deliberately conservative and fail closed. It records the
product decision approved on 2026-08-28; it is not legal advice and does not
claim that Bulgarian/EU media-law review or publisher outreach has occurred.
That review remains required before public launch.

## Permitted sources

An article image may be displayed on the news home page only when a reviewer
has recorded one of these bases and linked the evidence:

- written publisher permission that covers this use;
- an appropriately licensed source or agency agreement that covers this use;
- a compatible Creative Commons licence;
- a public-domain work;
- an official institutional media library with explicit reuse terms.

The machine-readable allowlist is
[`news/config/image_rights_policy.json`](../../news/config/image_rights_policy.json).
It is the source used by the bundle validator. Changes to the allowlist require
a new explicit product approval and a dated policy update.

## Default decision

Anything else is denied for home-page display. In particular:

- `unknown` and `blocked` never qualify;
- a successful hotlink, HTTP 200 response, source-page link or outlet credit is
  not permission;
- an image found through search, social media or another publication does not
  qualify without a recorded reuse basis;
- attribution does not replace permission or a licence;
- silence or lack of response from a publisher is not consent.

Each cleared record must preserve the exact creator/rightsholder credit given
by the source, the credit and source links, the name and link of the permission
or licence basis, and the date it was checked. `display_home` may be true only
for an allowlisted status with all of that evidence.

The current article schema predates this policy and names the neutral authority
fields `licence_name` and `licence_url`. For `publisher_permission`, those two
fields hold the permission/agreement name and its reviewable evidence URL; they
must not contain an invented licence label. A later schema migration may rename
them to `basis_name` and `basis_url` without changing the policy meaning.

## Processing limits

Cropping, proxying, caching, downloading or generating responsive derivatives
requires a reuse basis that expressly permits the operation. Until that is
recorded, the application may only use the reviewed source URL in the manner
covered by the recorded authority. Documentary-looking AI imagery must not be
used as a substitute for photographs of real events.

## Launch condition and escalation

Before public launch, obtain a Bulgarian/EU media-law review of this policy and
any publisher or agency agreement. If that review narrows a permission, the
affected records become `blocked` immediately; uncertainty becomes `unknown`,
never an inferred approval.
