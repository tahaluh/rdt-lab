# RDT Lab

RDT Lab is a visual laboratory for demonstrating Reliable Data Transfer over UDP. The first version implements Stop-and-Wait with TypeScript, Node.js, Next.js, WebSocket, SQLite, and real UDP sockets through `node:dgram`.

## What Is RDT?

RDT, or Reliable Data Transfer, is the set of techniques used to deliver data correctly even when the transport layer may lose, delay, duplicate, or corrupt messages. In this lab, those problems are simulated by the application, but packets still travel through real UDP sockets on `localhost`.

## UDP vs TCP

UDP sends connectionless datagrams and does not guarantee delivery, ordering, or retransmission. TCP already provides reliability, ordering, retransmission, flow control, and congestion control. RDT Lab uses UDP so you can see how TCP-like reliability mechanisms can be built on top of a simpler transport service.

## Stop-and-Wait

Stop-and-Wait is reliable because the client sends one packet, starts a timer, and only moves forward after receiving the correct ACK. If the packet or ACK is lost, the timer expires and the client retransmits the same packet.

The server uses checksums to discard corrupted packets and sequence numbers `0/1` to detect duplicates without writing the same payload twice.

Stop-and-Wait is slow because there is at most one packet in flight. With larger files, a lot of time is spent waiting for ACKs before the next block can be sent.

## Running the Project

```bash
cd rdt-lab
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

Available scripts:

- `npm run dev`: starts the custom Node server with Next.js, WebSocket, UDP client/server, the RDT engine, and SQLite in one process.
- `npm run dev:watch`: starts the same development server with process restart on server-side file changes.
- `npm run build`: builds the Next.js app and the custom server.
- `npm run start`: starts the production server after a build.
- `npm run udp:client`: sends a dashboard-created external UDP run from a real CLI UDP client.
- `npm run seed:files`: recreates sample files in `data/input`.
- `npm run typecheck`: runs TypeScript checks.

Docker development with hot reload:

```bash
docker compose --profile dev up rdt-lab-dev --build
```

Open `http://127.0.0.1:3000`. Source files are mounted into the container, Next.js handles frontend hot reload, and `tsx watch` restarts the custom server for server/RDT changes.

## Execution Modes

By default, the app runs automatically: the browser starts a run over HTTPS, then the backend runs both the UDP client and UDP server in the same Node process. This works from any browser without installing or running anything else.

Browsers cannot open raw UDP sockets. The experimental CLI client is kept for network-capture experiments, but it is not part of the default dashboard flow:

```bash
npm run udp:client -- --base-url https://your-dashboard.example --run RUN_ID --host UDP_PUBLIC_HOST --port 4000
```

The CLI fetches the run metadata and source file over HTTPS, then sends the file chunks as UDP datagrams to the UDP server. Capture with a filter such as:

```text
udp.port == 4000
```

For internet deployments, expose the UDP port directly on the host/firewall. A normal Cloudflare HTTPS proxy does not forward arbitrary UDP traffic.

The dashboard currently always uses the automatic backend execution mode.

Useful environment variables:

- `RDT_UDP_BIND_HOST`: UDP bind address, default `0.0.0.0`.
- `RDT_UDP_PORT`: UDP listen port for external runs, default `4000`.
- `RDT_UDP_PUBLIC_HOST`: public host/IP shown to the external client. Set this to the VPS public IP or a DNS-only hostname.
- `RDT_PUBLIC_BASE_URL`: optional dashboard URL used in server-generated command metadata.

## Dashboard Overview

The dashboard is designed as a transport-protocol lab, not just a monitor. It lets you configure scenarios, follow execution in real time, inspect individual packets, replay previous runs, and compare results.

Main regions:

- Top bar: current run, protocol, elapsed time, progress, pause, stop, save, replay, and theme controls.
- Configuration: file upload, random byte generation, text generation, exact packet-count generation, payload size, loss, corruption, delay, jitter, RTT, timeout, and demo options.
- Packet grid: one square per packet, with state colors and detailed tooltips.
- Packet timeline: per-packet event history with timestamp, origin, icon, color, and description.
- Statistics: packet, ACK, retransmission, duplicate, corruption, timeout, loss, byte, throughput, RTT, hash, integrity, efficiency, retransmission, and overhead metrics.
- Logs: terminal-like CLIENT, SERVER, and CHANNEL logs with filters, search, and export.
- Comparison/history: saved runs can be opened, replayed, duplicated, or selected for comparison.
- Real-time charts: progress/throughput, RTT, retransmissions, event distribution, and packets in flight.
- Transmission map: visual Client -> Channel -> Server flow with an in-flight indicator.

## Packet States

Each square in the packet grid represents one packet:

- Pending: not created yet.
- Sent: sent by the client.
- Received: received by the server.
- Acknowledged: ACK received by the client.
- Lost: dropped by the simulated unreliable channel.
- Corrupted: checksum failed or corruption was injected.
- Retransmitted: sent again after timeout.
- Duplicated: received again by the server and not written twice.

Packet tooltips show:

- packet id
- attempts
- checksum status
- ACK status
- elapsed packet time

## Demo Scenarios

- No loss: set packet loss, ACK loss, and corruption to `0%`. The grid should become green and the final SHA-256 hashes should match.
- Packet loss: increase packet loss. The log should show `PACKET_LOST`, timeout, and retransmission.
- ACK loss: increase ACK loss. The server receives the same packet again, emits `DUPLICATE_RECEIVED`, does not write the payload twice, and sends another ACK.
- Corruption: increase corruption. The server discards packets with invalid checksums and the client retransmits after timeout.
- Duplicate packet: use ACK loss with a short timeout. The duplicate appears in the grid and in the packet timeline.
- Integrity check: at the end, compare original and received SHA-256 hashes. Integrity should be OK for successful runs.

## Replay

Every run is stored in SQLite. Replay reconstructs the visualization from saved events:

- packet grid
- packet timeline
- logs
- statistics
- charts

Replay controls include pause/resume, step backward/forward, and speeds `0.5x`, `1x`, `2x`, and `5x`.

## Architecture

```text
1 Node process
├─ Next.js dashboard
├─ WebSocket at /ws
├─ UDP client with node:dgram
├─ UDP server with node:dgram
├─ Stop-and-Wait engine
└─ SQLite at data/rdt.sqlite
```

UDP is not implemented inside Next.js API routes. The custom Node server runs the dashboard, WebSocket layer, UDP client/server, RDT engine, and SQLite persistence in the same process.

Every RDT event is:

1. emitted on the event bus;
2. sent to the dashboard through WebSocket;
3. persisted in SQLite.

Runs are stored in the `runs` table and events are stored in the `events` table. A saved run can be opened at `/runs/{runId}`.

## Data Folders

```text
data/
├─ input/      # source files used by the client
├─ output/     # received files reconstructed by the server
└─ rdt.sqlite  # runs and events database
```

## Planned Extensions

The codebase is structured to support future protocols without redesigning the dashboard:

- Go-Back-N
- Selective Repeat
- configurable sliding window sizes
- side-by-side protocol comparison
- richer replay controls
- JSON and CSV export
- heatmap by file region
- global event timeline improvements
