# Neuron Platform — PROJECT MEMORY

> Treat this document as the source of truth across stages. It is updated at
> the end of every stage.

## Stage 1 — Libraries + Schemas

=== PROJECT MEMORY ===

### Decisions (architecture choices)

- **Block-of-ShitalEco deployment**. Neuron lives at
  `/home/user/ShitalEco/neuron-platform/` and ships through the existing
  ShitalEco CI/CD/nginx/Render pipeline. Public URL: `neuron.shital.org.uk`.
- **Library-first**. Five libraries (components, control boards, micro-compute,
  digital twin controls, ui controls) plus a `shared_schemas/` directory that
  contains every JSON Schema referenced by the rest of the platform.
- **One manifest envelope** for every library item (see
  `shared_schemas/manifest_schema.json`). Avoids per-library schema drift.
- **JSON over YAML** for manifests (the spec allowed either) — to remove a
  YAML dependency and let the validator run with stdlib + jsonschema only.
- **Four-level hierarchy** confirmed: Master/Root → Regional → Node/Edge → Devices
  (per architecture diagram). Real-time control never depends on Levels 2/3.

### Interfaces

- **Schemas** (`shared_schemas/`):
  - `manifest_schema.json` — universal library item envelope.
  - `pinmap_schema.json` — output of pin allocator (auto + manual override).
  - `dna_schema.json` — immutable per-device identity + capability record.
    Carries `base_firmware_version`, `app_bundle_version`, `config_schema_version`.
  - `brain_schema.json` — control loops, safety interlocks, telemetry, offline policy.
  - `ota_manifest_schema.json` — `min_supported_base_firmware_version`,
    `supported_hardware_revisions`, `target_app_bundle_version`,
    `target_config_schema_version`, `rollback_allowed`, signed artifacts.
  - `api_key_schema.json` — id, scopes, tier, rate-limit, hash, status.
  - `access_policy_schema.json` — deny-by-default inbound + outbound + MQTT ACL +
    emergency channel for the Edge Gateway.
- **MQTT topic shape** (locked for Stage 3):
  `twin/<control_kind>/<instance>/{desired|reported|current}/<field>`
  (see `bindings_templates/heater_pico_l298n.json`).
- **API endpoints** — defined by Stage 2; not implemented yet.

### Library Schemas (manifest formats)

- Universal envelope fields: `stable_id`, `name`, `vendor`, `version` (SemVer),
  `library`, `category`, `description`, `tags`, `image`, `capabilities`,
  `dependencies`, `interfaces`, `power`, `safety_class`, `drivers`,
  `self_tests`, `compatibility`, `twin_bindings`, `ui_bindings`, `metadata`.
- `safety_class ∈ {nominal, advisory, critical, life_safety}` — drives default
  alarm latching and ACL behaviour at the edge.
- Driver `runtime ∈ {micropython, cpython, linux_pkg, node}`.
- `compatibility.{boards|compute|twin_controls|ui_widgets}` cross-references
  resolved by the validator.

### Security Model (allow-lists, mTLS, key mgmt)

- Defined in schema only this stage; enforced in Stage 3.
- `access_policy_schema.json` mandates: inbound `default: deny`, outbound
  `default: deny`, allow-lists keyed on `principal ∈ {parent_node, emergency,
  local_device, master}`, mTLS required by default (cert fingerprints
  pinned), MQTT ACL with `pub|sub|pubsub`, emergency override channel with a
  separate cert and a strictly limited `command_set` of `safe_stop`,
  `safe_shutdown`, `status`.
- API keys are stored as Argon2id hashes; tiers `admin|integration|device|readonly`.
- Key rotation supported via `rotated_from` link and `status: rotated`.

### Versioning / OTA Policy (SemVer + base-version gating)

- All manifests use SemVer 2.0.0 (validator enforces).
- DNA carries the three independent versions (`base_firmware_version`,
  `app_bundle_version`, `config_schema_version`).
- OTA manifest must declare `min_supported_base_firmware_version`,
  `supported_hardware_revisions`, `target_app_bundle_version`,
  `target_config_schema_version`. Rejection rules:
  - device base < `min_supported_base_firmware_version` → reject.
  - device hardware_revision ∉ `supported_hardware_revisions` → reject.
  - downgrade forbidden unless `rollback_allowed: true` on a signed manifest.

### Safety Rules (safe states, failover logic)

- Brain config (`brain_schema.json`) carries an explicit `safety.safe_state`
  output map plus `interlocks` with actions `go_safe | stop_loop | raise_alarm
  | fail_open | fail_closed` and a watchdog (`watchdog_ms`).
- Twin Heater Control state machine includes a global `* → SAFE` transition on
  `interlock_trip` and `* → FAULT` on `sensor_fault`.
- Default offline policy is `continue_safe` with a buffered telemetry queue —
  mode is configurable per device.

### Open Items

- **Stage 2** scope:
  - FastAPI Master Platform skeleton (`/api/root-systems`, `/api/node-systems`,
    `/api/edge-systems`, `/api/devices`, `/api/library/*`, pinmap auto/manual,
    DNA + Brain generation, firmware bundle build, processes).
  - SQLite dev DB with clean Postgres migration path.
  - Minimal Admin/Build/Config UI: library browse + create root/node/edge +
    assign hardware + auto pin map + manual override + show DNA + Brain.
- **Stage 3** scope:
  - Edge Runtime services (gateway, registry, twin cache, command router,
    log/trace, health) with mTLS + allow-list enforcement.
  - Pico 2 W firmware first slice: DNA, heartbeat, offline mode, local test.
- Image assets currently shipped as inline SVGs only for the UI controls
  library; component/board PNG/SVG assets are TODO and tracked here as the
  only manifest reference that doesn't yet resolve to a real file.

=== END PROJECT MEMORY ===

---

## Next Stage: Stage 2 — Master Platform Core
