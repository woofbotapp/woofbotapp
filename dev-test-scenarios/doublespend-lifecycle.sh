#!/bin/bash

${BASH_SOURCE%/*}/requirements.sh

echo "Starting a second node and connecting"
bitcoind -port=18445 -rpcport=8333 -datadir=/bitcoin/data2 -regtest=1 -printtoconsole=0 &
bitcoin-cli addnode "127.0.0.1:18445" add
while [ `bitcoin-cli getaddednodeinfo | jq '.[0].connected'` = "false" ]
do
  echo "Still not connected"
  sleep 5
done
echo "Connected!"
bitcoin-cli getaddednodeinfo

echo "Mining 251 blocks (without reusing addresses)"
for index in {1..251}
do
  if (( $index % 10 == 0 ))
  then
    echo "block $index"
  fi
  bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress` > /dev/null
done

echo "Block count on main node:"
bitcoin-cli getblockcount
echo "Block count on second node:"
bitcoin-cli -rpcport=8333 getblockcount

echo "Broadcasting 50 transactions to have a non-empty mempool"
for index in {1..50}
do
  if (( $index % 10 == 0 ))
  then
    echo "broadcast $index"
  fi
  bitcoin-cli sendtoaddress `bitcoin-cli getnewaddress` 0.001 > /dev/null
done
echo "Mempool Info:"
bitcoin-cli getmempoolinfo

all_unspent=`bitcoin-cli listunspent 1 9999999 [] true '{"minimumAmount":0.00001001}' | jq -rc '. | sort_by(-.amount)'`
echo "Number of utxos: `echo $all_unspent | jq '. | length'`"
unspent=`echo $all_unspent | jq -rc '.[0]'`
all_unspent=`echo $all_unspent | jq -rc '.[1:]'`
if [ -z "$unspent" ] || [ "null" = "$unspent" ]
then
  echo "Could not find any UTXO with more than 0.002 BTC"
  exit 1
fi
echo "UTXO:"
jq -n --argjson unspent $unspent '$unspent | .'

source_address=`jq -nr --argjson unspent $unspent '$unspent | .address'`
echo ""
echo "Source Address: $source_address"
qrencode -t ansiutf8 $source_address
echo ""

target_address1=`bitcoin-cli getnewaddress`
echo ""
echo "Target Address: $target_address1"
qrencode -t ansiutf8 $target_address1
echo ""

source_txid=`jq -nr --argjson unspent $unspent '$unspent | .txid'`
source_vout=`jq -nr --argjson unspent $unspent '$unspent | .vout'`
# 500 sats fee
unspent_amount=`jq -nr --argjson unspent $unspent '$unspent | (.amount * 100000000 - 500) / 100000000'`
tx_input=`jq -n -c --arg txid $source_txid --arg vout $source_vout '[{"txid": $txid, "vout": $vout|tonumber}]'`
tx_output1=`jq -n -c --arg address $target_address1 --arg amount $unspent_amount '{($address): $amount|tonumber}'`
echo "Creating Transaction1 $tx_input -> $tx_output1"
transaction1=`bitcoin-cli createrawtransaction $tx_input $tx_output1`
echo "Signing Transaction1"
signed_transaction1=`bitcoin-cli signrawtransactionwithwallet $transaction1 | jq -r '.hex'`
echo "Signed Transaction1 hex: $signed_transaction1"
txid1=`bitcoin-cli decoderawtransaction $signed_transaction1 | jq -r '.txid'`

echo ""
echo "Transaction1 Id: $txid1"
qrencode -t ansiutf8 $txid1
echo ""

target_address2=`bitcoin-cli getnewaddress`
echo ""
echo "Target Address: $target_address2"
qrencode -t ansiutf8 $target_address2
echo ""

tx_output2=`jq -n -c --arg address $target_address2 --arg amount $unspent_amount '{($address): $amount|tonumber}'`
echo "Creating Transaction2 $tx_input -> $tx_output2"
transaction2=`bitcoin-cli createrawtransaction $tx_input $tx_output2`
echo "Signing Transaction2"
signed_transaction2=`bitcoin-cli signrawtransactionwithwallet $transaction2 | jq -r '.hex'`
echo "Signed Transaction2 hex: $signed_transaction2"
txid2=`bitcoin-cli decoderawtransaction $signed_transaction2 | jq -r '.txid'`

echo ""
echo "Transaction2 Id: $txid2"
qrencode -t ansiutf8 $txid2
echo ""

echo "Press Enter to broadcast 25 unrelated transactions"
read
for index in {1..25}
do
  stub_target_address=`bitcoin-cli getnewaddress`
  stub_unspent=`echo $all_unspent | jq -rc '.[0]'`
  all_unspent=`echo $all_unspent | jq -rc '.[1:]'`
  stub_unspent_txid=`jq -nr --argjson unspent $stub_unspent '$unspent | .txid'`
  stub_unspent_vout=`jq -nr --argjson unspent $stub_unspent '$unspent | .vout'`
  # 1000 sats fee
  stub_unspent_amount=`jq -nr --argjson unspent $stub_unspent '$unspent | (.amount * 100000000 - 1000) / 100000000'`
  stub_tx_input=`jq -nc --arg txid $stub_unspent_txid --arg vout $stub_unspent_vout '[{"txid": $txid, "vout": $vout|tonumber}]'`
  stub_tx_output=`jq -nc --arg address $stub_target_address --arg amount $stub_unspent_amount '{($address): $amount|tonumber}'`
  echo "Creating Stub Transaction $stub_tx_input $stub_tx_output"
  stub_transaction=`bitcoin-cli createrawtransaction $stub_tx_input $stub_tx_output`
  echo "Signing Stub Transaction $index"
  stub_signed_transaction=`bitcoin-cli signrawtransactionwithwallet $stub_transaction | jq -r '.hex'`
  echo "Broadcasting Stub Transaction $index"
  bitcoin-cli sendrawtransaction $stub_signed_transaction
done
echo "Mempool info:"
bitcoin-cli getmempoolinfo

echo "Disconnecting from second node"
bitcoin-cli addnode "127.0.0.1:18445" remove
bitcoin-cli disconnectnode 127.0.0.1:18445
sleep 5
echo "Peer info on main node:"
bitcoin-cli getpeerinfo
echo "Peer info on second node:"
bitcoin-cli -rpcport=8333 getpeerinfo

echo "Press Enter to broadcast transaction1"
read
bitcoin-cli sendrawtransaction $signed_transaction1

echo "Press Enter to broadcast transaction2 from second node"
read
bitcoin-cli -rpcport=8333 sendrawtransaction $signed_transaction2

while true; do
    read -p "Transaction1 should now be in the mempool. Do you want to mine one block? (y/n) " answer
    case $answer in
        [Yy]* ) bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress`; break;;
        [Nn]* ) break;;
        * ) echo "Please answer y or n.";;
    esac
done

echo "Press Enter to mine 2 blocks in the second node."
read
bitcoin-cli -rpcport=8333 generatetoaddress 1 `bitcoin-cli getnewaddress`
bitcoin-cli -rpcport=8333 generatetoaddress 1 `bitcoin-cli getnewaddress`

echo "Press Enter to connect the nodes."
read
bitcoin-cli addnode "127.0.0.1:18445" add
while [ `bitcoin-cli getaddednodeinfo | jq '.[0].connected'` = "false" ]
do
  echo "Still not connected"
  sleep 5
done
echo "Connected!"
bitcoin-cli getaddednodeinfo

echo "Press Enter to mine 5 more blocks so Transaction2 will be fully confirmed"
read
bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress`
for block_index in {1..4}
do
  echo "sleeping 5 seconds before mining the next block"
  sleep 5
  bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress`
done
