# SK-002 local Supabase network review

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-fixtures`

Branch: `task/SK-001-fixtures`

Scope: read-only inspection and pinned-source research. No container, Docker network, Docker Desktop setting, volume, runtime configuration or root application file was changed.

## Finding

The exposure comes from an omitted host address in Supabase CLI's published-port arguments. The running Kong, Postgres and Mailpit containers have `HostConfig.PortBindings[].HostIp == ""`; Docker therefore publishes ports 54321, 54322 and 54324 on `0.0.0.0` and `[::]`. Their generated bridge, `supabase_network_sankalpa-slot-0`, has no `com.docker.network.bridge.host_binding_ipv4` option.

Supabase documents an existing user-defined bridge whose default host binding is `127.0.0.1`, passed to `supabase start --network-id`. That documented workaround was tested by the coordinator and **failed on this host's Docker Desktop 29.4.2**. The network had the exact option, every container used only that network, and the CLI left `HostConfig.PortBindings[].HostIp` empty, yet Docker Desktop created `NetworkSettings.Ports` entries for `0.0.0.0` and `::`. The post-start guard detected the exposure and failed the start. The coordinator then stopped the stack; the named database volume remained.

Docker's documented reliable boundary is an explicit host address in each publish argument: `-p 127.0.0.1:HOST_PORT:CONTAINER_PORT`. Supabase CLI 2.116.0 offers no bind-host flag or local config key and does not emit that address. The smallest project-scoped correction is therefore an invocation-local `docker` shim used only by the Supabase child process. It must rewrite the pinned CLI's `docker create -p HOST_PORT:CONTAINER_PORT[/protocol]` arguments to include `127.0.0.1`, reject any explicit non-loopback publish, and forward all other Docker commands unchanged to the absolute real CLI path. Keep the post-start inspection as the acceptance gate.

## Pinned CLI evidence

The installed package reports Supabase CLI `2.116.0`. Its local `start --help` and `stop --help` both expose the global flag:

```text
--network-id string  use the specified docker network instead of a generated one
```

At tag `v2.116.0`, `resolveDockerNetworkMode` gives an explicit non-empty `--network-id` precedence over the generated `supabase_network_<project>` value. `ensureDockerNetwork` first inspects that name and returns without replacing an existing network. The container builder emits `-p hostPort:containerPort` with no host IP and `--network <network-id>`. This combination is why the bridge's `host_binding_ipv4` option supplies the missing bind address.

The same pinned `stop` help says only `--no-backup` deletes data volumes. The handler confirms ordinary `stop` removes containers but retains labeled volumes and reports local data as backed up to Docker volume.

## Project-scoped implementation contract

The coordinator's local runtime wrapper should:

1. Resolve the real Docker CLI before changing `PATH` (`/usr/local/bin/docker` on this host).
2. Generate an owner-only ignored executable at `.local/docker-bin/docker` or point that command name at a committed shim.
3. Give only the Supabase CLI subprocess a `PATH` beginning with `.local/docker-bin`; keep the coordinator's own inspect/network calls on the real Docker CLI.
4. For `docker create`, rewrite every pinned simple mapping matching `HOST_PORT:CONTAINER_PORT[/tcp|udp]` to `127.0.0.1:HOST_PORT:CONTAINER_PORT[/tcp|udp]`. Leave an existing `127.0.0.1:` mapping unchanged. Reject other explicit host addresses or unrecognized publish syntax instead of passing a potentially public mapping.
5. Forward non-create commands and arguments byte-for-byte and preserve the real Docker exit status/signals.
6. Start on the custom bridge as defense in depth, then require every `NetworkSettings.Ports[].HostIp` to equal `127.0.0.1` before writing environment files or reporting readiness.

The transition remains data-preserving:

```sh
npx supabase --workdir /Users/rajesh/sankalpa/.local/backend stop

docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
  --label app.sankalpa.runtime-root=/Users/rajesh/sankalpa \
  sankalpa-slot-0-loopback

PATH="/Users/rajesh/sankalpa/.local/docker-bin:$PATH" \
  npx supabase --workdir /Users/rajesh/sankalpa/.local/backend \
    start --network-id sankalpa-slot-0-loopback
```

Do not run the shown `PATH` command until the shim exists and its rewrite has a focused argument test. Do not pass `--no-backup`, remove/prune volumes, or reuse the generated bridge: bridge driver options cannot be changed in place. The custom bridge deliberately uses an application ownership label rather than `com.supabase.cli.project`; ordinary Supabase stop prunes its own labeled networks, while this persistent bridge should survive for the next start.

Any future command that recreates a local database container, especially `supabase db reset`, must receive the same `--network-id` or be routed through the wrapper. The CLI flag is invocation-scoped; an older but still relevant upstream report documents a split-network reset when the flag is omitted.

## Required verification after restart

```sh
docker network inspect sankalpa-slot-0-loopback \
  --format '{{json .Options}}'

docker ps --filter label=com.supabase.cli.project=sankalpa-slot-0 \
  --format '{{.Names}} {{.Ports}}'

docker inspect \
  --format '{{json .NetworkSettings.Ports}}' \
  supabase_kong_sankalpa-slot-0 \
  supabase_db_sankalpa-slot-0 \
  supabase_inbucket_sankalpa-slot-0

docker volume inspect supabase_db_sankalpa-slot-0 \
  --format '{{.Name}} {{.CreatedAt}}'
```

The network options should contain `"com.docker.network.bridge.host_binding_ipv4":"127.0.0.1"`, but that is only defense in depth on this Docker Desktop release. Every published host binding must independently be `127.0.0.1`; no `0.0.0.0` or `::` entry may remain. The database volume must still exist, and application/database/mail readiness checks must pass before the transition is accepted.

## Authoritative references

- [Supabase local development guide](https://supabase.com/docs/guides/local-development) gives the exact `docker network create -o 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1' local-network` and `supabase start --network-id local-network` sequence and says the local stack must not be exposed publicly.
- [Supabase CLI v2.116.0 network resolution](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/shared/functions/functions-docker.ts#L35-L68) shows explicit `--network-id` precedence; [existing-network handling](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/shared/functions/functions-docker.ts#L264-L300) shows that an existing custom network is retained.
- [Supabase CLI v2.116.0 container arguments](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/shared/db-bootstrap/docker-create-args.ts#L411-L414) omit a host IP from each `-p` mapping, and [attach each service to the selected network](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/shared/db-bootstrap/docker-create-args.ts#L493-L518).
- [Docker bridge driver documentation](https://docs.docker.com/engine/network/drivers/bridge/#default-host-binding-address) defines `com.docker.network.bridge.host_binding_ipv4` as the default address when `-p` omits one; the default without it is all IPv4 and IPv6 addresses. The observed Docker Desktop 29.4.2 result does not match this documented behavior.
- [Docker Desktop networking documentation](https://docs.docker.com/desktop/features/networking/#port-mapping) explains that host publishing is implemented by the Docker Desktop backend on macOS and shows an explicit `127.0.0.1` publish address as the way to restrict a mapping.
- [Supabase CLI issue 4644](https://github.com/supabase/cli/issues/4644) records the invocation-scoped `--network-id` risk for `db reset`. It was reported on CLI 2.67.2 and closed as stale, so it is operational caution rather than proof of a 2.116 regression.
