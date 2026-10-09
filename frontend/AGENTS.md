# AGENTS.md

## Project Rules

This project contains existing code that must be preserved.

The agent must follow all rules in this file when working on the project.

---

## 1. DO NOT MODIFY EXISTING CODE WITHOUT PERMISSION

Existing code is considered protected by default.

Unless the user explicitly asks for a file, component, function, or code section to be modified, DO NOT:

- Rewrite existing files
- Refactor existing code
- Delete existing code
- Rename files
- Rename folders
- Rename components
- Rename functions
- Rename variables
- Move files or folders
- Change routes
- Change API endpoints
- Change API request/response structures
- Change application logic
- Change authentication logic
- Change existing UI behavior
- Replace libraries
- Upgrade/downgrade dependencies
- Modify package.json
- Modify configuration files

If a requested task can be completed without modifying existing code,
preserve the existing code.

---

## 2. ONLY MODIFY WHAT THE USER REQUESTS

Changes must be limited to the exact scope requested by the user.

Example:

If the user asks:

"Fix HeroSection.jsx"

You may modify:

src/components/home/HeroSection.jsx

You must NOT automatically modify:

src/components/home/FacilitiesSection.jsx
src/pages/public/HomePage.jsx
src/index.css
package.json
vite.config.js

unless those changes are necessary.

If another file must be changed for the requested task to work,
explain why before changing it.

---

## 3. ASK BEFORE DESTRUCTIVE OR LARGE CHANGES

Before performing any large or destructive change, ask for permission.

This includes:

- deleting files
- replacing an entire file
- restructuring folders
- changing project architecture
- changing routing architecture
- replacing existing components
- changing API architecture
- changing state-management architecture
- replacing libraries
- removing dependencies
- performing project-wide refactors

Do not assume permission.

---

## 4. PRESERVE WORKING FEATURES

Existing working features must continue to work.

Before changing code, inspect the relevant implementation and understand:

- imports
- routes
- component relationships
- props
- state
- API calls
- authentication
- shared components
- dependencies

Do not break existing functionality while implementing a new feature.

---

## 5. API CODE IS PROTECTED

Do not modify existing API integration unless explicitly requested.

Protected areas include:

src/api/
src/services/

and any code containing:

- API URLs
- axios instances
- fetch calls
- request DTOs
- response mapping
- authentication tokens
- interceptors

UI tasks should not change API behavior.

---

## 6. ROUTES ARE PROTECTED

Do not change existing routes unless explicitly requested.

Examples:

/
/facilities
/how-it-works
/pricing
/support
/login
/register
/portal/\*

When creating UI, use the existing routing structure.

Do not invent replacement routes when an appropriate route already exists.

---

## 7. DO NOT REMOVE CODE BECAUSE IT LOOKS UNUSED

Do not delete:

- imports
- functions
- components
- CSS
- utilities
- API methods
- routes

simply because they appear unused.

They may be required by another part of the project.

Only remove code when the user explicitly requests cleanup/removal.

---

## 8. UI CHANGES

When the user requests UI changes:

You MAY change:

- JSX structure inside the requested component
- Tailwind classes
- CSS directly related to the requested UI
- animations requested by the user
- responsive layout
- visual spacing
- typography
- colors

You MUST preserve unless explicitly requested:

- API calls
- business logic
- route paths
- authentication
- data structures
- component contracts
- form submission behavior

---

## 9. NEW FEATURES

Prefer adding new code instead of replacing working code.

For example:

Preferred:

src/components/reactbits/FadeContent.jsx

instead of rewriting an unrelated shared component.

New components should integrate with the current project architecture.

---

## 10. BUG FIXES

When fixing a bug:

1. Identify the root cause.
2. Modify the smallest possible amount of code.
3. Do not refactor unrelated code.
4. Do not redesign unrelated UI.
5. Preserve existing behavior.
6. Verify that the fix does not create new errors.

If the bug can be fixed by changing one file, do not modify five files.

---

## 11. DEPENDENCIES

Do not install new packages unless necessary for the requested feature.

Before adding a package:

1. Check whether the project already has a suitable dependency.
2. Prefer existing project libraries.
3. Do not replace existing libraries without permission.

Do not run:

npm uninstall
npm update

unless explicitly requested.

Do not change dependency versions simply because newer versions exist.

---

## 12. SHADCN/UI

This project uses shadcn/ui.

Reuse existing components from:

src/components/ui/

when appropriate.

Do not replace shadcn/ui with another UI framework unless explicitly requested.

---

## 13. REACT BITS

React Bits effects may be used for visual enhancements.

Keep React Bits components isolated under:

src/components/reactbits/

Animations must not change:

- business logic
- routing
- API behavior
- authentication
- form behavior

Animations should enhance the UI without replacing functional components.

---

## 14. BEFORE EDITING

Before modifying code:

1. Read this AGENTS.md.
2. Inspect the target file.
3. Inspect directly related files when necessary.
4. Determine the minimum required change.
5. Preserve existing implementation wherever possible.

Do not immediately rewrite files after receiving a task.

---

## 15. AFTER EDITING

After changes:

1. Check imports.
2. Check JSX syntax.
3. Check for missing closing tags.
4. Check routes.
5. Check affected components.
6. Run the appropriate validation when possible.

For this project, normally run:

```bash
npm run build
```
