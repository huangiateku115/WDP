# Customer avatar upload — 2026-10-12

Status: Frontend preview and direct unsigned Cloudinary upload implemented. **Account avatar persistence is blocked by the existing Backend contract.** No Backend code, DTO, endpoint, token storage, or authentication behavior was changed.

## Files

- `src/lib/cloudinary.js` (new): file validation, public configuration, approved HTTPS image URL validation, multipart upload, timeout/abort and safe errors.
- `src/components/customer/ProfileAvatar.jsx` (new): accessible camera/file picker, preview/fallback, Cancel, loading/duplicate guards and explicit upload-only feedback. Accepts an optional `savedUrl` for a future confirmed response mapping; the current page does not guess a field.
- `src/pages/customer/ProfilePage.jsx`: only imports and mounts the avatar component in the existing avatar position. Components are keyed by the existing session token to abort/discard requests after session changes.
- `.env.example`: appended the two missing public Cloudinary settings. `.env` already contains both requested values and was left unchanged.
- `.design-reference/check-profile-avatar.cjs` (new): reproducible isolated browser tests.
- This report (new).

## Upload

Browser POSTs to `https://api.cloudinary.com/v1_1/tzk7vj1a/image/upload` using `FormData` fields `file` and `upload_preset=selfstorage_avatars`. Configuration comes from `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET`. The browser supplies the multipart boundary; the utility sends no application authorization header or credentials. No extra Axios instance, dependency, signature, API key/secret or Backend image upload was added.

JPEG/PNG/WebP MIME types and nonempty files up to 2 MiB are checked before upload. Successful responses require `secure_url` under `https://res.cloudinary.com/{configured-cloud}/image/upload/` and a nonempty `public_id`. The utility returns both. Temporary object URLs are revoked on replacement, cancel and unmount. Requests timeout after 60 seconds and abort on cancel/unmount. Aborted or stale-session results cannot update a later user's UI/session.

The current UI offers **Upload image** and explains that the resulting image is not saved to the account. **Save avatar remains disabled**. Uploaded URL/ID stays only in component memory; it is not persisted in localStorage or passed to a fabricated Backend field. Refresh discards the temporary preview. No automatic Cloudinary deletion occurs.

## Verified Backend incompatibility

Inspected current local Backend source:

- `src/routes/user.routes.ts`: authenticated `PUT /api/v1/users/me/profile`, `GET /api/v1/users/me`.
- `src/controllers/users/user.controller.ts` → `updateMyProfile`: destructures only `displayName` and `phone`; passes only those to the service. Extra avatar properties would be ignored, even if the response reports success.
- `src/services/users/user.service.ts` → `updateMyProfile`: assigns `user.displayName`, conditionally `user.phone`, saves, and synchronizes the name with Keycloak. It never accepts or assigns an avatar URL.
- `src/types/user.type.ts` (`IUser`) and `src/models/users/user.model.ts`: no avatar URL field or validation.
- `getMe` returns `req.user`; `src/middlewares/auth/requireAuth.ts` loads the MongoDB User document. Consequently no stored avatar can be returned by the current implementation.
- Separate CustomerProfile model/type/controller accepts identityCard/address/taxCode and handles verification; it also has no avatar field. It was not modified.
- No dedicated avatar/profile URL validation schema exists on the user profile route.
- Frontend `profileFromResponse()` preserves response fields, but the session identity whitelist currently retains only id/displayName/email/phone/role. That mapping remains unchanged until a Backend avatar field is confirmed.

Backend team must choose and confirm a single URL field, add it to the model/type and authenticated profile update path, enforce HTTPS and the approved `res.cloudinary.com/tzk7vj1a/image/upload/` path, and return it from GET Profile. Avatar-only updates must preserve existing displayName/phone rather than overwrite them with undefined. Backend should store only the URL, never upload files or generate signatures. After that contract is confirmed, Frontend can narrowly map the field through the existing userApi, refresh authApi.me, verify returned persistence, and synchronize the existing session whitelist. **None of these missing Backend changes were implemented or assumed.**

## Validation

- `npm run build`: passed. Existing warning about the main chunk exceeding 500 kB remains.
- `node .design-reference/check-profile-avatar.cjs`: passed with mocked Backend and Cloudinary responses. Checks profile load/fallback/picker, rejected formats/oversize, preview/cancel/resource cleanup, multipart fields/no auth, duplicate suppression, HTTP/network/invalid response errors, cancellation and session change, zero avatar PUTs/no fake storage, existing contact/password/identity submissions, four widths (1440/768/390/320), no horizontal overflow/page errors.
- These fixture tests do not establish real Backend persistence, refresh persistence or logout/login persistence. Those are unsupported until Backend changes are delivered. No real customer credentials or account mutations were used.
- Live Cloudinary check: attempted one direct browser upload of a tiny synthetic PNG using the configured cloud/preset. It failed with a connection/network error (`Cannot connect to Cloudinary`). No successful real secure_url/public_id response was confirmed; this result does not establish whether the preset is valid. A network/CORS/cloud configuration check is still required. An accepted request whose response was lost could leave an orphan; no deletion was attempted.

## Unsigned upload limits

The public cloud name/preset is visible to users and can be abused outside the UI. Frontend size/type checks are not a security boundary: configure equivalent format/size restrictions on the unsigned preset and monitor quotas. Uploads that are canceled after acceptance, abandoned, fail future Backend saving, or are replaced can leave orphaned images. The current blocked persistence flow also leaves upload-only images. The browser has no authorized deletion mechanism; asset lifecycle/cleanup needs a separately approved process. Never put a Cloudinary secret in Vite variables.
