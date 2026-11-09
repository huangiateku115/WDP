# Customer Web avatar

The profile avatar is read-only. The page displays an optional HTTPS `avatarUrl` from the existing authenticated profile response, or a default avatar when the field is absent, invalid or the image fails to load. The current Backend user model does not declare an avatar URL field.

The browser file picker, unsigned upload and avatar-specific Vite configuration have been removed. Contact details, password and identity still use their existing profile endpoints. Inventory images and signed-paper evidence use their own Backend upload routes and do not depend on Customer Web avatar settings.
