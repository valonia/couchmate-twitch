# Twitch – a Couchmate plugin

A front page like twitch.tv: featured streams, popular streams in your language, top categories and a row per big category. Twitch categories and channels in search, live chat, and streams that play in sync for everyone.

**Requires:** Internet access from the server to twitch.tv. No Twitch account needed.

## Install

In the Couchmate admin panel, open **Plugins**: it is listed under **Get plugins** – press **Install**, then switch
it on and fill in its settings.

## Updates

The server checks this repository for new releases every 6 hours. Under **Plugins** you can update with one
click, or switch on **Update automatically** to have new versions installed as soon as they are released.

To release a new version: raise `version` in `plugin.json`, commit, and publish a GitHub release tagged
`v<version>` (e.g. `v2.1.0`).

## Settings

- **Your channels (shown first when they are live)** – Twitch names separated by commas, e.g. "lofigirl, xqc".
- **Extra row for a language** – "auto" = the TV's language (no extra row for English), a language code such as "sv", or empty for no such row.
- **Number of popular streams (6–30)**
- **Rows for the biggest categories** – A row of streams for each of the biggest categories, e.g. Just Chatting (0–6).
- **Client ID** – The client ID Twitch's website uses. Only change it if Twitch changes something.

## Making your own

Plugins are plain JavaScript modules – `index.mjs` here is a working example to start from.
