# Link Proxy (TypeScript edition)

Broken, I gave up on this so... Tell me when you fix it and either spam ping me on GitHub or Discord.
It's not actually a proxy since I was too lazy to properly implement one. It'd be 20x easier if it was actually a proxy, though.

## Why not Rust?

I'm too lazy to continue my original Rust version,
due to the fact that I can mostly paste the code from Miniblox for a lot of stuff.

## How it works

First of all, we dump all the protobufs using [Miniblox dumpers](https://codeberg.org/Miniblox/dumpers),
I (99%) vibekobed the protobuf dumping, so don't expect it to work purrfectly (:cat:).

## Requirements

- Bun (for as long as you want to run this)
- mkcert (during setup, we need to make certificates for localhost)
- my [dumpers](https://codeberg.org/Miniblox/dumpers), specifically the protobuf dumper.

To install the required tools:

### Installing Bun

See their documentation [here](https://bun.com/). You just run a one line install command that installs Bun for you.

### Installing `mkcert`

Since Miniblox runs from a HTTPS context, we can't connect to a websocket over HTTP,
this is what web browsers call "mixed content" (secure content mixing with insecure content or vice versa is NOT a good idea in terms of security).
But what if you *could* make a local websocket over HTTPS without taking days to i.e. get approved and get a localhost certificate?
`mkcert` lets us do that, without approval or other hassles.

> [!CAUTION]
> The rootCA-key.pem file that mkcert automatically generates gives **complete** power to **intercept secure requests** from **your** machine.
> Do **not** share it.

- Install [mkcert](https://github.com/FiloSottile/mkcert)
- Make your device trust mkcert's root CA (which you should NOT share as I said earlier), `mkcert -install`
- Make a certs directory where you cloned the repository (ie. the directory where you're reading the ReadME from)
- Run `mkcert -key-file key.pem -cert-file cert.pem localhost` in the [certs directory](/certs/) to make a certificate for localhost.

## How do I use this

- Clone this repo (or download it, but then you'll have to re-download it whenever I update it)
- Run it using Bun: `bun run ./src/index.ts`
