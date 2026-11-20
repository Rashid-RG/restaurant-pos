# Dedicated GastroFlow OSRM staging deployment (not activated)

This folder contains a **single-host staging reference** for a private OSRM route server.
It is not connected to Render, Oracle, production, or any live database.

1. Provision a host sized for the regional extract and preprocessing. OSRM dataset files must be prepared using the *same* pinned OSRM image version, typically with `osrm-extract`, `osrm-partition`, and `osrm-customize` using the car profile. Never preprocess on the production database host.
2. Name the prepared dataset `data/region.osrm` and keep its companion files in the same directory. Do not commit downloaded maps or dataset files.
3. Provide a random secret at least 32 characters long in the host environment: `GASTROFLOW_ROUTING_KEY`. Never commit it.
4. Run `docker compose up -d --build`. Container gateway only binds loopback:8080.
5. Configure your own HTTPS ingress to forward only the dedicated routing hostname to gateway port 8080. Apply request-rate limits, TLS, firewall restrictions and uptime monitoring.
6. Only after staging connectivity and authorization tests: set `GASTROFLOW_ROUTING_URL` and the identical `GASTROFLOW_ROUTING_KEY` on **gastroflow-staging**. Do not change production. Test a disposable delivery order.
7. Verify that a request without the key is forbidden and that authenticated route requests return OSRM `code:Ok` with valid geometry. Validate router endpoint from staging backend. Use private synthetic positions during setup.

**Limitations:** Gateway protects the route API but the health endpoint should remain restricted by the HTTPS proxy. No production-grade autoscaling, auditing, traffic service, or historical speed model is provided. OSRM duration is a road estimate, not live-traffic ETA. Map data updates, region coverage and availability must be maintained by the operator.
