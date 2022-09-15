#!/bin/bash

dpkg -l qrencode 1> /dev/null 2> /dev/null
QRENCODE_INSTALLED=$?

dpkg -l jq 1> /dev/null 2> /dev/null
JQ_INSTALLED=$?

if [ $QRENCODE_INSTALLED -ne 0 ] || [ $JQ_INSTALLED -ne 0 ]
then
  apt update
fi

if [ $QRENCODE_INSTALLED -ne 0 ]
then
  apt install -y qrencode
fi

if [ $JQ_INSTALLED -ne 0 ]; then
  apt install -y jq
fi

# Create wallet if does not exist
bitcoin-cli createwallet testwallet 2> /dev/null
bitcoin-cli loadwallet testwallet 2> /dev/null
