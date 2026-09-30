# Third-party notices

Lockred Projects uses the open-source components below. All are under permissive licenses. No copyleft (GPL/LGPL/AGPL/MPL) code is included in the application. The full license text of each package ships in its `LICENSE` file inside `node_modules` and in the Docker images.

| Component | License | Copyright |
|---|---|---|
| Next.js | MIT | © Vercel, Inc. |
| React, React DOM | MIT | © Meta Platforms, Inc. and affiliates |
| NestJS (`@nestjs/common`, `core`, `platform-express`, `schedule`, `throttler`) | MIT | © Kamil Myśliwiec |
| Express, multer, cookie-parser | MIT | © OpenJS Foundation and contributors |
| Prisma ORM (`prisma`, `@prisma/client`) | Apache-2.0 | © Prisma Data, Inc. |
| Stripe Node.js library | MIT | © Stripe, Inc. |
| node-argon2 | MIT | © Ranieri Althoff |
| otplib | MIT | © Gerald Yeo |
| node-qrcode | MIT | © Ryan Day |
| Nodemailer | MIT-0 | © Andris Reinman |
| Zod | MIT | © Colin McDonnell |
| RxJS | Apache-2.0 | © Google, Inc., Netflix, Inc., Microsoft Corp. and contributors |
| reflect-metadata | Apache-2.0 | © Microsoft Corporation |
| TypeScript (build only) | Apache-2.0 | © Microsoft Corporation |
| IBM Plex Sans, IBM Plex Mono | SIL Open Font License 1.1 | © IBM Corp. |
| Schibsted Grotesk | SIL Open Font License 1.1 | © Schibsted Media Group |
| Fontsource packages | MIT (packaging) / OFL-1.1 (fonts) | © Fontsource contributors |
| Node.js (runtime image) | MIT | © OpenJS Foundation and contributors |
| PostgreSQL (database image) | PostgreSQL License | © The PostgreSQL Global Development Group |
| Traefik (not bundled; your reverse proxy) | MIT | © Traefik Labs |
| tini (API image init) | MIT | © Thomas Orozco |

`caniuse-lite` (browser data used by Next.js at build time) is CC-BY-4.0, an attribution license: © Alexis Deveria and contributors.

Next.js lists `sharp` as an optional dependency. Its prebuilt `libvips` binaries are LGPL-3.0. Lockred turns off Next.js image optimization and removes `sharp` and `@img/*` from the web image during the Docker build, so no LGPL code is shipped.

The base container images (Debian/Alpine) include operating-system packages under their own licenses, some of them GPL. These are separate programs run alongside the application, not part of it.

Transitive dependencies are otherwise permissively licensed. To produce a full list from a build, run in `api/` or `web/`:

```bash
npx license-checker-rseidelsohn --summary
```

and check that no GPL/AGPL/LGPL entries appear before each release.

A short version of this list is shown to users in the terms of service (`/terms#acknowledgments`).
