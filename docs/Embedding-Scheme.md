# Embedding Scheme
In this section we describe how the WienAsset protocol encodes asset issuance and transfer, loosely referred to as "embedded" wienasset transaction.

The WienAsset protocol uses two types of Wienchain OP_CODES to store asset manipulation instructions on top of the Wienchain blockchain.
* [OP_RETURN](#op_return) outputs
* [Multisignature](#multisignature-addresses-multisig) addresses *(optional)*

## OP_RETURN
Soon after the advent of Bitcoin, users started to look for [ways to embed data on the Bitcoin Blockchain](Data-Storage-Methods.md), some of which were less than ideal from the Bitcoin network's perspective. To accommodate that need, support for a new OP_CODE was added. This OP_CODE called [OP_RETURN](http://bitzuma.com/posts/op-return-and-the-future-of-bitcoin/) was especially designed for storing **small** amounts of arbitrary data on the Bitcoin blockchain.

At the moment of writing, the Bitcoin network accepts transactions with *at most one* OP_RETURN output of the form
```
 OP_RETURN <up to 80 bytes of arbitrary data>
```

All asset manipulation data is [stored](#asset-manipulating-transactions) after the OP_RETURN command. However, since the protocol supports adding arbitrary amounts of [metadata](Metadata) stored in [IPFS](#metadata-and-ipfs) we may need extra room to store the IPFS hash itself to allow retrieval and verification of the metadata.

In those cases we encode the remaining data in an extra multisig output.

## Multisignature Addresses (multisig)
In general Bitcoin allows [**m out of N** multisignature addresses](http://bitcoin.stackexchange.com/questions/3718/what-are-multi-signature-transactions) with `m<N` such that `m` signatures are needed in order to redeem the script.

Multisignature addresses are not meant to be used for encoding data on the blockchain and have several [disadvantages](Data Storage Methods#1-of-n-multisig-address) in that regard. 
Since we do not want to put a permanent burden on the memory of nodes in the Bitcoin network we use multisig addresses of the form **1** out of N. This way we can quickly spend that single UTXO (so that miners can remove it from the list of UTXOs kept in memory) and use the remaining `N-1` public key slots (32 bytes each) to encode data. 
In what follows we use the following shorthand notation to denote 1 out of N multisig addresses: 
```
(1|N) = 1 out of N mulitisig address
```

Currently, the wienasset protocol only uses `(1|2)` multisig addresses [where needed](#blockchain-data-recording-logic). It is possible in theory to add more data using higher `(1|N)` multisig with `N>2` but at the moment we avoid that extra complexity and resort to using an additional output if despite our compressed [transfer instructions](Transfer-Instructions) we still [run out of space](#asset-processing-capacity-per-transaction) with one OP_RETURN and a `(1|2)` multisig.

## Metadata and IPFS

The WienAsset protocol supports adding (potentially unlimited amounts of) [metadata](Metadata) to asset transaction ([issuance](#issuance-transaction-encoding) or [transfer](#transfer-transaction-encoding)). Adding metadata is strictly optional.

The metadata is not stored directly on the blockchain but rather stored in plain JSON format using IPFS. [IPFS](IPFS.md) give a decentralized way to share and store data. 

## Blockchain Data Recording logic
We start by trying to fit everything into the 80 bytes available after the OP_RETURN command.
* **Without metadata** there is always enough room to fit all asset manipulation instructions after the OP_RETURN.
* **With metadata**
    * If metadata is required and there is **enough** room to fit all asset manipulation instructions after the OP_RETURN, both asset manipulation instructions and IPFS hash of metadata is stored in OP_RETURN
    * If metadata is required and there is **not enough** room to fit all asset manipulation instructions after the OP_RETURN, the asset manipulation instructions are stored after the OP_RETURN while the IPFS hash of metadata is stored as `(1|2)` multisig transaction


## Asset Manipulating Transactions
The WienAsset protocol implementation uses two types of asset manipulation transactions:
### Issuance (and transfer) transactions
In an issuance transaction a new asset is created and many of the asset's attributes are being determined.
Optionally, we can also transfer assets during an issuance transaction (even assets created in that very transaction).
### Transfer only transactions
A transaction where only asset transfer occurs, no issuance.
### Burn transactions
In a burn transaction, a specified amount is being reduced from the total supply of an asset, i.e. these units are being "burned" and will not be available for further transfer.
Optionally, we can also transfer assets during a burn transaction.

### Issuance Transaction Encoding

| Bytes|Description              |Comments|Stored in|
| :----: |-------------------------------------|--------|-------|
| 2      | Protocol Identifier                 | `0x5741` ASCII representation of the string WA ("WienAsset")| OP_RETURN |
| 1      | Version Number                      | Currently `0x03`| OP_RETURN |
| 1      | **Issuance** [OP_CODEs](OP_CODEs)| | OP_RETURN |
| 34     | IPFS Hash | *OPTIONAL*, only when metadata is included| OP_RETURN<br/> or (1\|**2**) Multisig |
| 1-7    | [Amount](#amount) of **issued units**   | Encoded with the [Encoding Scheme](Number Encoding)|OP_RETURN|
|2-9 (per<br/>instruction)| [Transfer Instruction](Transfer Instructions)| Encoding the flow of assets from inputs to outputs |OP_RETURN|
| 1      | [Issuance Flags](#issuance-flag)     | At the moment only 6 bits are used| OP_RETURN|

### Transfer Transaction Encoding

| Bytes |Description                   |Comments|Stored in|
| :----: |-------------------------------------|--------|:-------:|
| 2      | Protocol Identifier                 | `0x5741` ASCII representation of the string WA ("WienAsset")| OP_RETURN |
| 1      | Version Number                      | Currently `0x03`| OP_RETURN |
| 1      | **Transfer** [OP_CODEs](OP_CODEs)| | OP_RETURN |
| 34     | IPFS Hash | *OPTIONAL*, only when metadata is included| OP_RETURN<br/> or (1\|**2**) Multisig |
| 2-9 (per<br/>instruction)| [Transfer Instruction](Transfer Instructions)| Encoding the flow of assets from inputs to outputs |OP_RETURN|

### Burn Transaction Encoding
Identical to [Transfer transaction encoding](#transfer-transaction-encoding), only that it uses **Burn** [OP_CODEs](OP_CODEs) instead of a Transfer OP_CODE.
Also, the [Transfer Instructions](Transfer Instructions) will be interpreted differently under a specific encoding to allow the burn itself.

### Amount

The number of issued units. A signed integer ranging from `1..10,000,000,000,000,000 (10^16)` encoded with our [Encoding Scheme](Number-Encoding).

&#42; Relevant only in the case of an issuance transaction<br>
&#42; Due to a bug in the original implementation, CC version 0x01 interprets the encoded amount as (amount / 10^divisiblity)

### Issuance Flags

This flags specify some extra information about a newly issued asset. At the moment only 6 bits are used (the remaining two reserved for future uses)

* The first 4 bits describe the [divisibility](Embedding-Scheme#asset-divisibility) of the asset
* The next bit designates whether the asset is [locked](Wienasset#coherent-issuance-policy) or [unlocked](Wienasset#coherent-issuance-policy)
* The next 2 bits determine the [aggregation policy](Embedding-Scheme#asset-aggregation-policy) of the asset

&#42; Relevant only in the case of an issuance transaction

### Asset Divisibility
Asset can be assigned an integer that denotes their divisibility. For example
* **divisibility:0** corresponds to integers (1, 2, 3, etc...)
* **divisibility:1** corresponds to divisibility of up to 1 decimal point (Numbers like 0.1, 0.9, 1.5, etc...)
* **divisibility:3** corresponds to divisibility of up to 3 decimal points (Numbers like 0.001, 0.999, 123.456, etc...)

Thus, if you issue 100 units of an asset with divisibility 0, you can send any integer amount (like 1 or 99 units) but you can also issue 100 whole units, and send 0.01 or 9.99 of that asset: with *amount* = 100,000 and *divisibility* = 2.
As an analogy, WIEN can be thought of as an asset with 21x10^14 units and divisibility 8 (the smallest indivisible units are Satoshis).

**Note: Since we are using only 4 bits for divisibility, the divisibility have to fall between 0 and 15**

### Asset Aggregation Policy
Asset instances can differ from each other in their accumulated metadata, which can be attached to any issuance or transfer throughout an asset colored transactions path.  
An example for such use case can be an issuance of some amount of a movies theater tickets, where the row and seat numbers which are described in the asset's metadata, individualize each ticket. Such assets are called **dispersed**.
The [encoding of transfer instructions](Transfer-Instructions) *must* treat each instance of such assets identified by a different accumulated metadata, with a *separate* transfer instruction. That enforces keeping the different asset instances unique.<br>
On the other hand, all asset units may be considered the same. For example, all units of an asset representing a currency coin are equal (as Bitcoin). Such assets are called **aggregatable**.
The encoding of transfer instructions *may* aggregate instances of such assets into a single transfer instruction, require less space in the OP_RETURN, and as effect a union of these instances will be created and all units within it will be unified as the same.
The 2-bit codes for each policy are as follows:

| Aggregation Policy |  Code |
|--------------------|:-----:|
|aggregatable		 | 0x00	 |
|hybrid				 | 0x01	 |
|dispersed			 | 0x02	 |

&#42; Note: **hybrid** is an intermediate aggregation policy and currently a placeholder for future development.

### OP_CODE
The [Issuance](#issuance_op_return) or [Transfer](#transfer_op_return) [OP_CODE](OP_CODEs)s to be executed during the processing of the transaction.

### Asset processing capacity per transaction
Note that the amount of assets that can be transferred in one transaction varies according to a number of parameters.
For example, if we have no metadata and all transfers use the minimum of 2 bytes, we may process up to 38 transfer instructions in a single *transfer* transaction and up to 37 (provided the issued amount can be encoded with 1 byte) in a single *issuance* transaction. 

In fact, the theoretical limit is much higher, due to the [encoding of transfer instructions](Transfer-Instructions) which sends all unaccounted assets to the last output (similar to how miners fee work in Wienchain). With this encoding, special cases can *in principle* be constructed where 1 transfer transaction processes an unlimited amount of assets, determined only by the asset content of the inputs.