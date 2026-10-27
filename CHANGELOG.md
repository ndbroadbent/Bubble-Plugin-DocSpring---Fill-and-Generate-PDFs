# Changelog

## 2.0.0

- The plugin now uses DocSpring's API v2. Self-hosted DocSpring servers need a release with API v2 (or keep plugin
  version 1.7.0).
- Create PDF Submission and Get PDF Submission keep their fields and results. Get PDF Submission's hash is now the
  PDF's SHA-256 hash (it was MD5), its Password is always empty (API v2 never returns passwords), and Response JSON
  has API v2's format.
- Get PDF Submission's Error Message now has the submission's error message when its PDF couldn't be generated (it
  was always empty), and Success stays yes: check Submission State.
- Submission State has API v2's values: a submission waiting for its signature requests is
  `waiting_for_signature_requests` (it was `waiting_for_data_requests`).
- API v2 checks data more strictly: date fields take `YYYY-MM-DD` dates, email fields take email addresses, and an
  empty Data list is checked against the template's required fields.
- Create PDF Submission can also set the template version, make page images, set a PDF password, set when the
  submission expires, override field settings (JSON) and choose whether the PDF stays editable.
- Errors show API v2's error code, message and details, then the record's ID and the request ID.
- Actions that wait for a file check after 1, 2 and 4 seconds, then every 8 seconds, for up to 45 seconds (1.7.0
  checked every second). When DocSpring's rate limit says to wait (a 429 with Retry-After), they wait that long if
  there's time, or return the record's ID as when the file isn't ready in time.
- Region: blank or US, EU, or your server's URL (a URL ending in `/api/v1` now uses `/api/v2`). The AU region has
  closed.
- New actions: Generate PDFs in a Batch, Get Submission Batch, Check Data, Find Submissions, Generate Submission
  Files, Expire Submission, Combine PDFs, Get Combined PDF, Create Signature Request, Create Signing Link, Get
  Signature Request, Find Templates, Get Template, Create Template, Replace Template PDF, Copy Template, Move
  Template, Publish Template Version, List Template Fields, Add Template Fields, Update Template Fields, Remove
  Template Fields, Get Template Page Images, List Folders, Create Folder, Create Webhook, Delete Webhook and Make an
  API Call.

## 1.7.0 (3 April 2026)

- Added the AU region and improved error handling.
