const {AbiCoder, ethers} = require('ethers');
require('dotenv').config();

// Import the contract ABI
const abi = require('./MachineStationFactoryABI.json');
const rpcURL = 'https://erpc-async.agung.peaq.network';
const chainID = 9990;

const failedDeployments = {};

// Contract details
const MachineStationFactoryContractAddress =
    process.env
        .MACHINE_STATION_CONTRACT_ADDRESS;  // Replace with the deployed Machine
                                            // station factory contract address

const contract =
    new ethers.ContractFactory(abi, MachineStationFactoryContractAddress);

// Wallet details
const stationManagerPrivateKey1 =
    process.env.STATION_MANAGER_1_PRIVATE_KEY;  // first station manager
const stationManagerPrivateKey2 =
    process.env.STATION_MANAGER_2_PRIVATE_KEY;  // second station manager
const machineOwnerPrivateKey = process.env.machineOwner_PRIVATE_KEY;

const provider = new ethers.JsonRpcProvider(rpcURL);

const stationManagetAccount1 =
    new ethers.Wallet(stationManagerPrivateKey1, provider);
const stationManagetAccount2 =
    new ethers.Wallet(stationManagerPrivateKey2, provider);
const machinestationManagetAccount1 =
    new ethers.Wallet(machineOwnerPrivateKey, provider);

console.log({
  stationManager1: stationManagetAccount1.address,
  stationManager2: stationManagetAccount2.address,
  machineOwner: machinestationManagetAccount1.address
});

async function signTypedDataDeployMachineSmartAccount(machineOwner, nonce) {
  // Define the EIP-712 Domain
  const domain = {
    name: 'MachineStationFactory',
    version: '1',
    chainId: chainID,
    verifyingContract: MachineStationFactoryContractAddress,
  };

  // Define the type definition for the data
  const types = {
    DeployMachineSmartAccount: [
      {name: 'machineOwner', type: 'address'},
      {name: 'nonce', type: 'uint256'},
    ],
  };

  // Define the data to be signed
  const message = {
    machineOwner: machineOwner,
    nonce: nonce,
  };

  // Sign the typed data
  const signature =
      await stationManagetAccount1.signTypedData(domain, types, message);

  return signature;
}

function getRandomNumber() {
  const now = BigInt(Date.now());
  const randomPart = BigInt(Math.floor(Math.random() * 1e18));
  return now * randomPart;
}

function encodeDeploySmartAccountMethod(machineOwner, nonce, signature) {
  // Encode the method call data
  return contract.interface.encodeFunctionData(
      'deployMachineSmartAccount', [machineOwner, nonce, signature]);
}

// Functions to interact with the contract
async function deployMachineSmartAccount(
    machineOwner, methodData, stationManager) {
  try {
    // Send the transaction and get the receipt
    const tx = {
      to: MachineStationFactoryContractAddress,
      data: methodData,
    };

    const txResponse = await stationManager.sendTransaction(tx);
    let receipt = await txResponse.wait(3).finally();

    const logs = receipt?.logs;

    // Compute the event signature
    const eventSignature = ethers.id('MachineSmartAccountDeployed(address)');
    console.log('eventSignature: ', eventSignature);

    // Find the relevant log
    const log = logs?.find((log) => log.topics[0] === eventSignature);

    console.log('raw log: ', log);

    if (!log) {
      throw new Error('MachineSmartAccountDeployed event not found in logs');
    }


    // The deployed address is stored as the second topic (topics[1]) in a
    // 32-byte format
    const rawDeployedAddress = log.topics[1];
    const deployedAddress = ethers.getAddress(
        `0x${rawDeployedAddress.slice(26)}`);  // Extract last 20 bytes

    console.log('Machine Deploy Tx executed:', receipt?.hash);
    console.log('Machine Deployed Address:', deployedAddress);

    if (failedDeployments[machineOwner].length > 0) {
      delete failedDeployments[machineOwner];
    }

    return deployedAddress;

  } catch (error) {
    failedDeployments[machineOwner] = machineOwner;
    console.error('Transaction failed. Error:', error);

    // Check if the error is a revert error with data
    if (error.data) {
      try {
        // Decode the revert error using the contract's ABI
        const iface = new ethers.Interface(contract.interface.fragments);
        const decodedError = iface.parseError(error.data);

        console.log('Decoded Error:', decodedError);

        // Extract error name and arguments
        // const { name, args } = decodedError;
        // console.log("Error Name:", name);
        // console.log("Arguments:", args);

        // if (name === "InvalidSignature") {
        //   console.error("InvalidSignature Error Details:");
        //   console.error("structHash:", args.structHash);
        //   console.error("nonce:", args.nonce.toString());
        // }
      } catch (decodeError) {
        console.error('Failed to decode error data:', decodeError);
      }
    } else {
      console.error('Transaction failed without revert data:', error);
    }
  }
}

async function processDeployment() {
  let totalRequest = 1000;

  for (let index = 0; index < totalRequest; index++) {
    let newMachineOwnerWallet = ethers.Wallet.createRandom(provider);
    let newMachineOwner = newMachineOwnerWallet.address;
    let nonce = getRandomNumber();
    let signature =
        await signTypedDataDeployMachineSmartAccount(newMachineOwner, nonce);
    let methodData =
        encodeDeploySmartAccountMethod(newMachineOwner, nonce, signature);
    // used first station manager
    deployMachineSmartAccount(methodData, stationManagerPrivateKey1);
  }
}

async function retryFailedDeployments() {
  for (const [_, value] of Object.entries(failedDeployments)) {
    let newMachineOwner = value;
    let nonce = getRandomNumber();
    let signature =
        await signTypedDataDeployMachineSmartAccount(newMachineOwner, nonce);
    let methodData =
        encodeDeploySmartAccountMethod(newMachineOwner, nonce, signature);
    // used second station manager
    deployMachineSmartAccount(methodData, stationManagerPrivateKey2);
  }
}


(async () => {
  encodeDeploySmartAccountMethod(
      machinestationManagetAccount1,
  );
//   setInterval(() => {
//     try {
//       retryFailedDeployments();
//     } catch (error) {
//       console.error('Error occurred:', error.message);
//     }
//   }, 5 * 60 * 1000);
});