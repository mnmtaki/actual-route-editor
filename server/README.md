# ARA Java Backend — first milestone

Spring Boot + Spring Security + JDBC + PostgreSQL + Flyway. Cloud archives use
the existing `ActualRouteProject` JSON format (stations, lines, geometry), so
the local IndexedDB library stays intact. This first milestone deliberately
does NOT implement multi-user realtime editing or Agent orchestration.

## Start
Requires Java 21, Maven and PostgreSQL. Create a database and a user, set
`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`, then run:

```sh
cd server
mvn spring-boot:run
```

Flyway applies `V1__accounts_and_projects.sql` on startup.

## Endpoints
- POST /api/auth/register: {"username":"alice","password":"strong-password"}
- POST /api/auth/login: returns accessToken; use Authorization: Bearer <token>
- GET /api/auth/me
- POST /api/auth/logout
- GET /api/projects: only the signed-in user's saves
- POST /api/projects: {"name":"city","document":<ActualRouteProject>}
- GET /api/projects/{uuid}
- PUT /api/projects/{uuid}: {"name":"city","document":<ActualRouteProject>,"expectedRevision":1}
- DELETE /api/projects/{uuid}

PUT uses an atomic version check; conflicts return HTTP 409 instead of
overwriting another browser's newer save. User scope is checked for all
reads and writes. 7-day random bearer tokens are stored only as SHA-256
hashes; password hashes use BCrypt.

## Known boundaries
- Frontend client adapter is opt-in, not an automatic replacement for local
  IndexedDB. Do not delete local saves after uploading.
- No refresh tokens, email recovery, anti-abuse controls, durable revision
  history, collaboration permissions or multi-instance sessions yet.
- Use TLS in deployment. Avoid storing bearer tokens in persistent browser
  storage; current frontend adapter accepts an in-memory token.
- Ensure production CORS configuration uses the trusted application origin.
- A single 8MB JSON size cap is a basic guard, not comprehensive schema
  validation. More extensive server-side project integrity checks are needed
  before enabling shared editing.
