# GastroFlow

Open-source restaurant software maintained by **Mohammed Rashid ([Rashid-RG](https://github.com/Rashid-RG))**: a staff POS and kitchen workspace, customer ordering app, and driver delivery app sharing one Express API.

**Development status:** this branch is a reviewed draft for a controlled pilot. It is not a claim of production certification. The [complete system review](docs/COMPREHENSIVE_REVIEW_2026-11-05.md) describes 249 microfeature review items, launch gaps, real-time tracking requirements and the roadmap. Historical readiness reports are superseded by that review.

| Application | Source | Built route |
| --- | --- | --- |
| Staff POS, kitchen and administration | `src/` | `/` |
| Customer ordering and tracking | `apps/customer-web/` | `/customer/` |
| Driver deliveries and location | `apps/driver-web/` | `/driver-app/` |

The code includes server-side billing, tenant-scoped staff events, menu and stock management, tables, kitchen tickets, customer accounts, PayHere integration, delivery assignment and browser GPS. The [billing follow-up](docs/BILLING_FOLLOWUP.md) documents settlement, refund, rounding and cash-drawer fixes and remaining release gates. Table merging is temporarily disabled until its billing flow is corrected. The [delivery-proof follow-up](docs/DELIVERY_PROOF_FOLLOWUP.md) adds private, transactional proof saving and safe retry. Several other capabilities remain partial: push delivery, durable event replay, scheduling and cloud printer connectivity. The [SaaS release gates](docs/SAAS_RELEASE_GATES.md) describe newer privacy, inventory and shared-order fixes and the remaining launch requirements. See the review before relying on any advertised feature.

## Local development

Use **Node.js 24** and npm. From the repository root:

```bash
npm ci
cp .env.example .env
```

For isolated local development, set `NODE_ENV=development` in `.env`; keep sample data and credentials local. Then run:

```bash
npm run start:all
```

| Service | Local address |
| --- | --- |
| Staff | http://localhost:3000 |
| Customer | http://localhost:3001 |
| Driver | http://localhost:3002 |
| API | http://localhost:5000 |

All three frontends build from the root dependency installation:

```bash
npm run build:all
npm run start:production
```

The production start command does not set `NODE_ENV`; set it explicitly in your deployment environment. Production startup requires distinct signing secrets, strong owner credentials, explicit HTTPS origins and PayHere settings. Follow the [deployment guide](docs/DEPLOYMENT_GUIDE.md).

## Storage and deployment

Local SQLite requires durable storage and one application instance. This branch adds an experimental remote libSQL adapter for a compatible Turso database. The client was tested against a local file; real cloud transactions, migration and restore remain release gates. PostgreSQL support is unfinished and blocked in production.

`render.yaml` describes a free demonstration deployment with external durable storage. It does not migrate the existing service or its data. Free Render hosting has sleep and persistence limitations; review the deployment guide before using it for restaurant operations.

## Validation

```bash
npm run check
npm test -- --maxWorkers=1
npm run build:all
node scripts/production-smoke.js
npm audit
```

The reviewed local draft passed 243 automated tests, all three frontend builds, production restart smoke checks and selected desktop/phone browser workflows. Passing these checks does not establish complete route coverage or provider/hardware certification. GitHub CI and a Docker image build must also pass in their respective environments.

The [microfeature CSV](docs/GastroFlow_Microfeature_Inventory.csv) and [API route CSV](docs/GastroFlow_API_Route_Inventory.csv) are implementation backlogs with source evidence. There are 154 distinct literal method/path patterns, including 13 repeated patterns that require consolidation.

## License

[MIT License](LICENSE). Copyright (c) 2026 Mohammed Rashid (Rashid-RG).

Current SaaS reliability work, validation boundaries and migration procedure: [SaaS release gates](docs/SAAS_RELEASE_GATES.md).
