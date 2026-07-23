# VoxFill Auth Portal

Standalone website for user signup, signin, and authenticated VoxFill extension downloads.

This folder is intentionally separate from the `VoxFill/` Chrome extension project so it can be pushed by another teammate without changing the extension architecture.

## Features

- Signup and signin pages in one responsive UI
- Server-side password hashing with Node `crypto.scrypt`
- HTTP-only session cookies
- Protected extension download route
- No external npm dependencies

## Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Package the extension

From this folder:

```bash
npm run package-extension
```

That creates:

```text
downloads/voxfill-extension.zip
```

Users must sign in before downloading the zip.

## Notes

- User and session data are stored locally in `data/`.
- `data/users.json`, `data/sessions.json`, and generated zip files are ignored by git.
- For production, replace file storage with a database and serve over HTTPS.
