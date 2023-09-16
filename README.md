[<p align="center"><img src="./packages/client/src/assets/images/logo.svg" width="150" height="150"></p>](https://github.com/woofbotapp/woofbotapp)


[![Twitter](https://img.shields.io/twitter/follow/woofbotapp?style=social)](https://twitter.com/woofbotapp)


# WoofBot

WoofBot is a chat bot that runs on your personal Bitcoin node and sends alerts based on
pre-configured conditions.

> ⚠️ WoofBot is currently in beta and is not considered secure.

It is currently supports only the [Telegram](https://telegram.org) chat platform.
I recommend using [Umbrel](https://getumbrel.com) to run this app.

## Development

The development environment is based on docker containers that communicate with each other.
For simplicity, I run each docker in a new terminal (easier to see logs).

To simulate an LND node, I recommend installing https://lightningpolar.com, and creating a basic
network with an LND node named "alice". See `.env.dev-polar` which configures `LND_TLS_PATH` to
`$HOME/.polar/networks/1/volumes/lnd/alice/tls.cert` (You can configure it to something else if
you already have a network with some other names).

Then run `yarn dev:build` and follow the instructions: it will print the yarn commands that need
to run, each in a separated terminal.
